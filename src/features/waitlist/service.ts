import { ObjectId, type WithId, MongoServerError } from 'mongodb';
import { ApiError } from '../../http.js';
import { objectId } from '../../ids.js';
import { isPastSlot } from '../../time.js';
import type { AuthContext } from '../auth/middleware.js';
import {
  assertFutureSlot,
  assertPartyFits,
  assertWithinHours,
  bookedTables,
  loadActiveRestaurant,
  touchRestaurant,
  touchSlot,
  withTransaction,
} from '../reservations/capacity.js';
import { reservations, type Reservation } from '../reservations/model.js';
import { processExpiredOffers, promoteWaitlist } from './promotion.js';
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
  assertPartyFits(restaurant, input.partySize, input.tablesRequested);

  const created = await withTransaction(async (session) => {
    await touchRestaurant(session, restaurantId);
    const currentRestaurant = await loadActiveRestaurant(restaurantId, session);
    assertWithinHours(currentRestaurant, input.reservationTime);
    assertPartyFits(currentRestaurant, input.partySize, input.tablesRequested);
    await touchSlot(session, restaurantId, input.reservationDate, input.reservationTime);
    const booked = await bookedTables(session, restaurantId, input.reservationDate, input.reservationTime);
    const available = currentRestaurant.totalTables - booked;
    const queued = await waitlist.findOne(
      { restaurantId, reservationDate: input.reservationDate, reservationTime: input.reservationTime, status: { $in: ['waiting', 'offered'] } },
      { session },
    );
    if (!queued && available >= input.tablesRequested) {
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
      await promoteWaitlist(session, restaurantId, input.reservationDate, input.reservationTime);
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
  await processExpiredOffers(auth.userId);
  const docs = await waitlist.find({ userId: auth.userId }).sort({ createdAt: -1 }).toArray();
  return docs.map(publicWaitlistEntry);
}

/** Accept an open offer: recheck capacity, then convert it to a reservation. */
export async function acceptWaitlistOffer(auth: AuthContext, id: string) {
  const entry = await loadEntry(id);
  assertOwner(auth, entry.userId);
  const outcome = await withTransaction(async (session) => {
    await touchSlot(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
    const current = await waitlist.findOne({ _id: entry._id }, { session });
    if (!current || current.status !== 'offered') {
      throw new ApiError(409, 'NO_OPEN_OFFER', 'This waitlist entry has no open offer to accept');
    }

    if (current.offerExpiresAt && current.offerExpiresAt.getTime() <= Date.now()) {
      await waitlist.updateOne(
        { _id: entry._id, status: 'offered' },
        { $set: { status: 'expired', updatedAt: new Date() }, $unset: { offerExpiresAt: '' } },
        { session },
      );
      await promoteWaitlist(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
      return { kind: 'error' as const, code: 'OFFER_EXPIRED', message: 'This offer has expired' };
    }

    if (isPastSlot(current.reservationDate, current.reservationTime)) {
      await waitlist.updateOne(
        { _id: entry._id, status: 'offered' },
        { $set: { status: 'expired', updatedAt: new Date() }, $unset: { offerExpiresAt: '' } },
        { session },
      );
      return { kind: 'error' as const, code: 'SLOT_IN_PAST', message: 'This reservation slot is now in the past' };
    }

    await touchRestaurant(session, entry.restaurantId);
    const restaurant = await loadActiveRestaurant(entry.restaurantId, session);
    assertPartyFits(restaurant, current.partySize, current.tablesRequested);
    const booked = await bookedTables(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
    if (current.tablesRequested > restaurant.totalTables - booked) {
      // Capacity vanished before acceptance — roll the offer to the next in line.
      await waitlist.updateOne(
        { _id: entry._id, status: 'offered' },
        { $set: { status: 'expired', updatedAt: new Date() }, $unset: { offerExpiresAt: '' } },
        { session },
      );
      await promoteWaitlist(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
      return { kind: 'error' as const, code: 'SLOT_FULL', message: 'Slot filled before the offer was accepted' };
    }

    const now = new Date();
    const doc: Reservation = {
      userId: current.userId,
      restaurantId: current.restaurantId,
      reservationDate: current.reservationDate,
      reservationTime: current.reservationTime,
      partySize: current.partySize,
      tablesRequested: current.tablesRequested,
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
    await promoteWaitlist(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
    return { kind: 'reservation' as const, reservation: { ...doc, _id: insertedId } as WithId<Reservation> };
  });

  if (outcome.kind === 'error') throw new ApiError(409, outcome.code, outcome.message);
  const reservation = outcome.reservation;

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
  await withTransaction(async (session) => {
    await touchSlot(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
    const current = await waitlist.findOne({ _id: entry._id }, { session });
    if (!current) throw new ApiError(404, 'WAITLIST_ENTRY_NOT_FOUND', 'Waitlist entry not found');
    assertOwner(auth, current.userId);
    if (current.status !== 'waiting' && current.status !== 'offered') {
      throw new ApiError(409, 'NOT_ACTIVE', 'Only active waitlist entries can be left');
    }
    const now = new Date();
    await waitlist.updateOne(
      { _id: entry._id },
      { $set: { status: 'cancelled', updatedAt: now }, $unset: { offerExpiresAt: '' } },
      { session },
    );
    await promoteWaitlist(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
  });
}
