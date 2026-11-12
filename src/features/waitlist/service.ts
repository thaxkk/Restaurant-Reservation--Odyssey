import { ObjectId, type WithId, MongoServerError } from 'mongodb';
import { ApiError } from '../../http.js';
import { objectId } from '../../ids.js';
import type { AuthContext } from '../auth/middleware.js';
import {
  assertFutureSlot,
  assertWithinHours,
  bookedTables,
  loadActiveRestaurant,
  touchSlot,
  withTransaction,
} from '../reservations/capacity.js';
import { reservations, type Reservation } from '../reservations/model.js';
import { expireStaleOffers, promoteWaitlist } from './promotion.js';
import {
  publicWaitlistEntry,
  waitlist,
  type WaitlistEntry,
} from './model.js';
import type { JoinWaitlistInput } from './schemas.js';

function assertOwner(auth: AuthContext, ownerId: ObjectId): void {
  if (!auth.userId.equals(ownerId)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this waitlist entry');
  }
}

async function loadEntry(id: string): Promise<WithId<WaitlistEntry>> {
  const entry = await waitlist.findOne({ _id: objectId(id) });
  if (!entry) throw new ApiError(404, 'WAITLIST_ENTRY_NOT_FOUND', 'Waitlist entry not found');
  return entry;
}

/** Join a slot's FIFO queue. Only allowed when the slot is actually full. */
export async function joinWaitlist(auth: AuthContext, input: JoinWaitlistInput) {
  const restaurantId = objectId(input.restaurantId, 'INVALID_RESTAURANT_ID');
  const restaurant = await loadActiveRestaurant(restaurantId);
  assertWithinHours(restaurant, input.reservationTime);
  assertFutureSlot(input.reservationDate, input.reservationTime);

  const created = await withTransaction(async (session) => {
    await touchSlot(session, restaurantId, input.reservationDate, input.reservationTime);
    const booked = await bookedTables(session, restaurantId, input.reservationDate, input.reservationTime);
    const available = restaurant.totalTables - booked;
    if (available >= input.tablesRequested) {
      // There is room — the user should book directly instead of waiting.
      throw new ApiError(409, 'SLOT_AVAILABLE', 'Slot has capacity; create a reservation instead');
    }

    const now = new Date();
    const doc: WaitlistEntry = {
      userId: auth.userId,
      restaurantId,
      reservationDate: input.reservationDate,
      reservationTime: input.reservationTime,
      partySize: input.partySize,
      tablesRequested: input.tablesRequested,
      status: 'waiting',
      createdAt: now,
      updatedAt: now,
    };
    try {
      const { insertedId } = await waitlist.insertOne(doc, { session });
      return { ...doc, _id: insertedId } as WithId<WaitlistEntry>;
    } catch (error) {
      // Unique partial index: one active (waiting/offered) entry per user+slot.
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new ApiError(409, 'ALREADY_WAITING', 'You already have an active waitlist entry for this slot');
      }
      throw error;
    }
  });

  return publicWaitlistEntry(created);
}

/** List the caller's waitlist entries (expiring any stale offers first). */
export async function listWaitlist(auth: AuthContext) {
  await withTransaction((session) => expireStaleOffers(session, auth.userId));
  const docs = await waitlist.find({ userId: auth.userId }).sort({ createdAt: -1 }).toArray();
  return docs.map(publicWaitlistEntry);
}

/** Accept an open offer: recheck capacity, then convert it to a reservation. */
export async function acceptWaitlistOffer(auth: AuthContext, id: string) {
  const entry = await loadEntry(id);
  assertOwner(auth, entry.userId);
  if (entry.status !== 'offered') {
    throw new ApiError(409, 'NO_OPEN_OFFER', 'This waitlist entry has no open offer to accept');
  }

  const reservation = await withTransaction(async (session) => {
    // Offer may have lapsed between read and transaction.
    if (entry.offerExpiresAt && entry.offerExpiresAt.getTime() <= Date.now()) {
      await waitlist.updateOne(
        { _id: entry._id, status: 'offered' },
        { $set: { status: 'expired', updatedAt: new Date() }, $unset: { offerExpiresAt: '' } },
        { session },
      );
      await promoteWaitlist(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
      throw new ApiError(409, 'OFFER_EXPIRED', 'This offer has expired');
    }

    const restaurant = await loadActiveRestaurant(entry.restaurantId);
    await touchSlot(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
    const booked = await bookedTables(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
    if (entry.tablesRequested > restaurant.totalTables - booked) {
      // Capacity vanished before acceptance — roll the offer to the next in line.
      await waitlist.updateOne(
        { _id: entry._id, status: 'offered' },
        { $set: { status: 'expired', updatedAt: new Date() }, $unset: { offerExpiresAt: '' } },
        { session },
      );
      await promoteWaitlist(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
      throw new ApiError(409, 'SLOT_FULL', 'Slot filled before the offer was accepted');
    }

    const now = new Date();
    const doc: Reservation = {
      userId: entry.userId,
      restaurantId: entry.restaurantId,
      reservationDate: entry.reservationDate,
      reservationTime: entry.reservationTime,
      partySize: entry.partySize,
      tablesRequested: entry.tablesRequested,
      status: 'confirmed',
      createdAt: now,
      updatedAt: now,
    };
    const { insertedId } = await reservations.insertOne(doc, { session });
    await waitlist.updateOne(
      { _id: entry._id },
      { $set: { status: 'accepted', updatedAt: now }, $unset: { offerExpiresAt: '' } },
      { session },
    );
    return { ...doc, _id: insertedId } as WithId<Reservation>;
  });

  return {
    id: reservation._id.toHexString(),
    restaurantId: reservation.restaurantId.toHexString(),
    reservationDate: reservation.reservationDate,
    reservationTime: reservation.reservationTime,
    partySize: reservation.partySize,
    tablesRequested: reservation.tablesRequested,
    status: reservation.status,
    createdAt: reservation.createdAt.toISOString(),
    updatedAt: reservation.updatedAt.toISOString(),
  };
}

/** Leave the waitlist. If an open offer is abandoned, roll it to the next entry. */
export async function leaveWaitlist(auth: AuthContext, id: string): Promise<void> {
  const entry = await loadEntry(id);
  assertOwner(auth, entry.userId);
  if (entry.status !== 'waiting' && entry.status !== 'offered') {
    throw new ApiError(409, 'NOT_ACTIVE', 'Only active waitlist entries can be left');
  }

  await withTransaction(async (session) => {
    const now = new Date();
    await waitlist.updateOne(
      { _id: entry._id },
      { $set: { status: 'cancelled', updatedAt: now }, $unset: { offerExpiresAt: '' } },
      { session },
    );
    if (entry.status === 'offered') {
      await promoteWaitlist(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
    }
  });
}
