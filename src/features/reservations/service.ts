import { ObjectId, type WithId } from 'mongodb';
import { ApiError } from '../../http.js';
import { objectId } from '../../ids.js';
import { bangkokNow, isPastSlot } from '../../time.js';
import type { AuthContext } from '../auth/middleware.js';
import { waitlist } from '../waitlist/model.js';
import { promoteWaitlist } from '../waitlist/promotion.js';
import {
  assertFutureSlot,
  assertPartyFits,
  assertWithinHours,
  bookedTables,
  loadActiveRestaurant,
  touchRestaurant,
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
 * `completed`. Called before user history and admin reservation queries so both
 * views return current status even when nobody has opened the booking recently.
 */
export async function settlePastReservations(userId?: ObjectId): Promise<void> {
  const now = new Date();
  const { date, time } = bangkokNow(now);
  await reservations.updateMany(
    {
      ...(userId ? { userId } : {}),
      status: 'confirmed',
      $or: [
        { reservationDate: { $lt: date } },
        { reservationDate: date, reservationTime: { $lt: time } },
      ],
    },
    { $set: { status: 'completed', updatedAt: now } },
  );
}

export async function createReservation(auth: AuthContext, input: CreateReservationInput) {
  const restaurantId = objectId(input.restaurantId, 'INVALID_RESTAURANT_ID');
  const restaurant = await loadActiveRestaurant(restaurantId);
  assertWithinHours(restaurant, input.reservationTime);
  assertFutureSlot(input.reservationDate, input.reservationTime);
  assertPartyFits(restaurant, input.partySize, input.tablesRequested);

  const created = await withTransaction(async (session) => {
    await touchRestaurant(session, restaurantId);
    const currentRestaurant = await loadActiveRestaurant(restaurantId, session);
    assertWithinHours(currentRestaurant, input.reservationTime);
    assertPartyFits(currentRestaurant, input.partySize, input.tablesRequested);
    await touchSlot(session, restaurantId, input.reservationDate, input.reservationTime);
    const queued = await waitlist.findOne(
      { restaurantId, reservationDate: input.reservationDate, reservationTime: input.reservationTime, status: { $in: ['waiting', 'offered'] } },
      { session },
    );
    if (queued) throw new ApiError(409, 'WAITLIST_PRIORITY', 'This slot is reserved for the waitlist');
    const booked = await bookedTables(session, restaurantId, input.reservationDate, input.reservationTime);
    const available = currentRestaurant.totalTables - booked;
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
  // Time and status are independent: past cancelled bookings remain in history.
  const { date, time } = bangkokNow();
  if (query.when === 'past') {
    filter.$or = [{ reservationDate: { $lt: date } }, { reservationDate: date, reservationTime: { $lt: time } }];
  }
  if (query.when === 'upcoming') {
    filter.$or = [{ reservationDate: { $gt: date } }, { reservationDate: date, reservationTime: { $gte: time } }];
  }
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
  const reservationId = objectId(id);
  const updated = await withTransaction(async (session) => {
    const existing = await reservations.findOne({ _id: reservationId }, { session });
    if (!existing) throw new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
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

    await touchRestaurant(session, existing.restaurantId);
    const restaurant = await loadActiveRestaurant(existing.restaurantId, session);
    assertWithinHours(restaurant, next.reservationTime);
    assertFutureSlot(next.reservationDate, next.reservationTime);
    assertPartyFits(restaurant, next.partySize, next.tablesRequested);

    // Serialize on both the old and new slot (identical when the slot is unchanged).
    await touchSlot(session, existing.restaurantId, existing.reservationDate, existing.reservationTime);
    await touchSlot(session, existing.restaurantId, next.reservationDate, next.reservationTime);

    const consumesNewCapacity = next.reservationDate !== existing.reservationDate ||
      next.reservationTime !== existing.reservationTime || next.tablesRequested > existing.tablesRequested;
    if (consumesNewCapacity) {
      const queued = await waitlist.findOne(
        { restaurantId: existing.restaurantId, reservationDate: next.reservationDate, reservationTime: next.reservationTime, status: { $in: ['waiting', 'offered'] } },
        { session },
      );
      if (queued) throw new ApiError(409, 'WAITLIST_PRIORITY', 'This slot is reserved for the waitlist');
    }

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
    await reservations.updateOne({ _id: existing._id, status: 'confirmed' }, { $set: { ...next, updatedAt: now } }, { session });

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
  const reservationId = objectId(id);
  await withTransaction(async (session) => {
    const existing = await reservations.findOne({ _id: reservationId }, { session });
    if (!existing) throw new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
    assertOwnerOrAdmin(auth, existing.userId);
    if (existing.status !== 'confirmed') {
      throw new ApiError(409, 'NOT_CANCELLABLE', 'Only confirmed reservations can be cancelled');
    }
    await touchSlot(session, existing.restaurantId, existing.reservationDate, existing.reservationTime);
    await reservations.updateOne(
      { _id: existing._id, status: 'confirmed' },
      { $set: { status: 'cancelled', updatedAt: new Date() } },
      { session },
    );
    // Cancellation releases capacity: offer it to the first waiting entry.
    await promoteWaitlist(session, existing.restaurantId, existing.reservationDate, existing.reservationTime);
  });
}
