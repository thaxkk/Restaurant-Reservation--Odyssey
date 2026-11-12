import { ObjectId, type WithId } from 'mongodb';
import { ApiError } from '../../http.js';
import { objectId } from '../../ids.js';
import { isPastSlot } from '../../time.js';
import type { AuthContext } from '../auth/middleware.js';
import { promoteWaitlist } from '../waitlist/promotion.js';
import {
  assertFutureSlot,
  assertWithinHours,
  bookedTables,
  loadActiveRestaurant,
  touchSlot,
  withTransaction,
} from './capacity.js';
import {
  publicReservation,
  reservations,
  type Reservation,
} from './model.js';
import type {
  CreateReservationInput,
  ListReservationsQuery,
  UpdateReservationInput,
} from './schemas.js';

function assertOwnerOrAdmin(auth: AuthContext, ownerId: ObjectId): void {
  if (auth.role !== 'admin' && !auth.userId.equals(ownerId)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this reservation');
  }
}

/** Load a reservation by id or throw 404. */
async function loadReservation(id: string): Promise<WithId<Reservation>> {
  const reservation = await reservations.findOne({ _id: objectId(id) });
  if (!reservation) throw new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
  return reservation;
}

/**
 * Persist completion: a confirmed booking whose slot is now in the past becomes
 * `completed`. Done lazily (scoped to the acting user) when they read history so
 * stored status stays consistent for admin queries without a background job.
 */
async function settlePastReservations(userId: ObjectId): Promise<void> {
  const now = new Date();
  const confirmed = await reservations.find({ userId, status: 'confirmed' }).toArray();
  const pastIds = confirmed
    .filter((r) => isPastSlot(r.reservationDate, r.reservationTime, now))
    .map((r) => r._id);
  if (pastIds.length > 0) {
    await reservations.updateMany(
      { _id: { $in: pastIds } },
      { $set: { status: 'completed', updatedAt: now } },
    );
  }
}

export async function createReservation(auth: AuthContext, input: CreateReservationInput) {
  const restaurantId = objectId(input.restaurantId, 'INVALID_RESTAURANT_ID');
  const restaurant = await loadActiveRestaurant(restaurantId);
  assertWithinHours(restaurant, input.reservationTime);
  assertFutureSlot(input.reservationDate, input.reservationTime);

  const created = await withTransaction(async (session) => {
    await touchSlot(session, restaurantId, input.reservationDate, input.reservationTime);
    const booked = await bookedTables(session, restaurantId, input.reservationDate, input.reservationTime);
    const available = restaurant.totalTables - booked;
    if (input.tablesRequested > available) {
      // Slot is full for the requested size — the client may join the waitlist.
      throw new ApiError(409, 'SLOT_FULL', `Slot is full: only ${Math.max(available, 0)} table(s) available`);
    }

    const now = new Date();
    const doc: Reservation = {
      userId: auth.userId,
      restaurantId,
      reservationDate: input.reservationDate,
      reservationTime: input.reservationTime,
      partySize: input.partySize,
      tablesRequested: input.tablesRequested,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await reservations.insertOne(doc, { session });
    return { ...doc, _id: insertedId } as WithId<Reservation>;
  });

  return publicReservation(created);
}

export async function listReservations(auth: AuthContext, query: ListReservationsQuery) {
  await settlePastReservations(auth.userId);

  const filter: Record<string, unknown> = { userId: auth.userId };
  if (query.status) filter.status = query.status;
  // `when` is a convenience over status: upcoming === confirmed (future, since
  // past-confirmed were just settled to completed); past === completed.
  if (query.when === 'upcoming') filter.status = 'confirmed';
  if (query.when === 'past') filter.status = 'completed';
  if (query.date) filter.reservationDate = query.date;
  if (query.restaurantId) filter.restaurantId = objectId(query.restaurantId, 'INVALID_RESTAURANT_ID');

  const docs = await reservations
    .find(filter)
    .sort({ reservationDate: -1, reservationTime: -1 })
    .toArray();
  return docs.map(publicReservation);
}

export async function getReservation(auth: AuthContext, id: string) {
  const reservation = await loadReservation(id);
  assertOwnerOrAdmin(auth, reservation.userId);

  // Reflect completion on read without a separate settle pass.
  if (reservation.status === 'confirmed' && isPastSlot(reservation.reservationDate, reservation.reservationTime)) {
    const now = new Date();
    await reservations.updateOne({ _id: reservation._id }, { $set: { status: 'completed', updatedAt: now } });
    reservation.status = 'completed';
    reservation.updatedAt = now;
  }
  return publicReservation(reservation);
}

export async function updateReservation(auth: AuthContext, id: string, input: UpdateReservationInput) {
  const existing = await loadReservation(id);
  assertOwnerOrAdmin(auth, existing.userId);
  if (existing.status !== 'confirmed') {
    throw new ApiError(409, 'NOT_EDITABLE', 'Only confirmed reservations can be edited');
  }

  const next = {
    reservationDate: input.reservationDate ?? existing.reservationDate,
    reservationTime: input.reservationTime ?? existing.reservationTime,
    partySize: input.partySize ?? existing.partySize,
    tablesRequested: input.tablesRequested ?? existing.tablesRequested,
  };

  const restaurant = await loadActiveRestaurant(existing.restaurantId);
  assertWithinHours(restaurant, next.reservationTime);
  assertFutureSlot(next.reservationDate, next.reservationTime);

  const updated = await withTransaction(async (session) => {
    // Serialize on both the old and new slot (identical when the slot is unchanged).
    await touchSlot(session, existing.restaurantId, existing.reservationDate, existing.reservationTime);
    await touchSlot(session, existing.restaurantId, next.reservationDate, next.reservationTime);

    // Capacity on the target slot, excluding this reservation's own current hold.
    const booked = await bookedTables(
      session,
      existing.restaurantId,
      next.reservationDate,
      next.reservationTime,
      existing._id,
    );
    if (next.tablesRequested > restaurant.totalTables - booked) {
      throw new ApiError(409, 'SLOT_FULL', 'Slot is full for the requested change');
    }

    const now = new Date();
    await reservations.updateOne({ _id: existing._id }, { $set: { ...next, updatedAt: now } }, { session });

    // Shrinking/moving may free capacity on the original slot — offer it onward.
    if (
      next.reservationDate !== existing.reservationDate ||
      next.reservationTime !== existing.reservationTime ||
      next.tablesRequested < existing.tablesRequested
    ) {
      await promoteWaitlist(session, existing.restaurantId, existing.reservationDate, existing.reservationTime);
    }
    return { ...existing, ...next, updatedAt: now } as WithId<Reservation>;
  });

  return publicReservation(updated);
}

export async function cancelReservation(auth: AuthContext, id: string): Promise<void> {
  const existing = await loadReservation(id);
  assertOwnerOrAdmin(auth, existing.userId);
  if (existing.status !== 'confirmed') {
    throw new ApiError(409, 'NOT_CANCELLABLE', 'Only confirmed reservations can be cancelled');
  }

  await withTransaction(async (session) => {
    await touchSlot(session, existing.restaurantId, existing.reservationDate, existing.reservationTime);
    await reservations.updateOne(
      { _id: existing._id },
      { $set: { status: 'cancelled', updatedAt: new Date() } },
      { session },
    );
    // Cancellation releases capacity: promote the earliest eligible waitlist entry.
    await promoteWaitlist(session, existing.restaurantId, existing.reservationDate, existing.reservationTime);
  });
}
