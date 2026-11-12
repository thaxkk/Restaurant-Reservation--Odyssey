// Low-level capacity + transaction primitives shared by the reservations and
// waitlist features. Nothing here imports the waitlist module, so the two
// features can depend on this file without a cycle.
import { ObjectId, type ClientSession, type WithId } from 'mongodb';
import { client } from '../../db.js';
import { ApiError } from '../../http.js';
import { isPastSlot } from '../../time.js';
import {
  reservations,
  reservationSlots,
  restaurants,
  type Restaurant,
} from './model.js';

const TXN_OPTIONS = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
} as const;

/**
 * Run `fn` inside a MongoDB transaction. The driver auto-retries on transient
 * errors (including the write conflicts our slot guard provokes), so concurrent
 * bookings of the same slot serialize safely. Non-transient errors (e.g. an
 * ApiError for a full slot) abort the transaction and propagate unchanged.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = client.startSession();
  try {
    return await session.withTransaction(fn, TXN_OPTIONS);
  } finally {
    await session.endSession();
  }
}

/** Load a restaurant that exists and is not soft-deleted, or throw 404. */
export async function loadActiveRestaurant(restaurantId: ObjectId): Promise<WithId<Restaurant>> {
  // `deletedAt: null` matches documents where the field is null OR missing.
  const restaurant = await restaurants.findOne({ _id: restaurantId, deletedAt: null });
  if (!restaurant) throw new ApiError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found');
  return restaurant;
}

/** Reject a reservation time outside the restaurant's opening hours. */
export function assertWithinHours(restaurant: Restaurant, time: string): void {
  const { opensAt, closesAt } = restaurant;
  const open =
    opensAt <= closesAt
      ? time >= opensAt && time <= closesAt // same-day hours
      : time >= opensAt || time <= closesAt; // overnight hours (e.g. 18:00–02:00)
  if (!open) {
    throw new ApiError(400, 'OUTSIDE_HOURS', `Time must be within opening hours ${opensAt}-${closesAt}`);
  }
}

/** Reject a slot that is in the past. */
export function assertFutureSlot(date: string, time: string): void {
  if (isPastSlot(date, time)) {
    throw new ApiError(400, 'SLOT_IN_PAST', 'Cannot book a reservation in the past');
  }
}

/**
 * Serialization point: bump the slot guard's version within the transaction so
 * concurrent writers to the same slot conflict and retry. Must be called before
 * reading booked capacity in the same transaction.
 */
export async function touchSlot(
  session: ClientSession,
  restaurantId: ObjectId,
  date: string,
  time: string,
): Promise<void> {
  await reservationSlots.updateOne(
    { restaurantId, reservationDate: date, reservationTime: time },
    {
      $inc: { version: 1 },
      $setOnInsert: { restaurantId, reservationDate: date, reservationTime: time },
    },
    { upsert: true, session },
  );
}

/** Sum of tables held by confirmed reservations in a slot (optionally excluding one). */
export async function bookedTables(
  session: ClientSession,
  restaurantId: ObjectId,
  date: string,
  time: string,
  excludeId?: ObjectId,
): Promise<number> {
  const match: Record<string, unknown> = {
    restaurantId,
    reservationDate: date,
    reservationTime: time,
    status: 'confirmed',
  };
  if (excludeId) match._id = { $ne: excludeId };

  const rows = await reservations
    .aggregate<{ tables: number }>(
      [
        { $match: match },
        { $group: { _id: null, tables: { $sum: '$tablesRequested' } } },
      ],
      { session },
    )
    .toArray();
  return rows[0]?.tables ?? 0;
}
