// FIFO promotion + offer expiry. Kept separate from waitlist/service.ts so the
// reservations feature can trigger promotion on cancel/edit without importing
// the waitlist service (avoids an import cycle). Depends only on the shared
// capacity primitives and the waitlist model.
import { ObjectId, type ClientSession } from 'mongodb';
import { isPastSlot } from '../../time.js';
import { bookedTables, touchRestaurant, touchSlot, withTransaction } from '../reservations/capacity.js';
import { restaurants } from '../reservations/model.js';
import { OFFER_TTL_MS, waitlist } from './model.js';

/**
 * Offer free capacity to the first waiting entry in strict queue order.
 * Called inside a transaction after capacity is released (cancel / shrink).
 *
 * At most one open offer per slot at a time: if an offer is already outstanding
 * we leave it be — the seat is spoken for until that offer is accepted or
 * expires (expiry re-invokes promotion for the next entry).
 */
export async function promoteWaitlist(
  session: ClientSession,
  restaurantId: ObjectId,
  date: string,
  time: string,
): Promise<void> {
  await touchSlot(session, restaurantId, date, time);
  const now = new Date();
  const outstanding = await waitlist.findOne(
    { restaurantId, reservationDate: date, reservationTime: time, status: 'offered' },
    { session },
  );
  if (outstanding) {
    if (!outstanding.offerExpiresAt || outstanding.offerExpiresAt > now) return;
    await waitlist.updateOne(
      { _id: outstanding._id, status: 'offered' },
      { $set: { status: 'expired', updatedAt: now }, $unset: { offerExpiresAt: '' } },
      { session },
    );
  }

  if (isPastSlot(date, time)) return;

  const restaurant = await restaurants.findOne({ _id: restaurantId, deletedAt: null }, { session });
  if (!restaurant) return;
  await touchRestaurant(session, restaurantId);
  const currentRestaurant = await restaurants.findOne({ _id: restaurantId, deletedAt: null }, { session });
  if (!currentRestaurant) return;

  const available = currentRestaurant.totalTables - (await bookedTables(session, restaurantId, date, time));
  if (available <= 0) return;

  // Strict FIFO: never skip an earlier entry that needs more tables.
  const next = await waitlist.findOne(
    {
      restaurantId,
      reservationDate: date,
      reservationTime: time,
      status: 'waiting',
    },
    { session, sort: { createdAt: 1, _id: 1 } },
  );
  if (!next || next.tablesRequested > available) return;

  await waitlist.updateOne(
    { _id: next._id },
    { $set: { status: 'offered', offerExpiresAt: new Date(now.getTime() + OFFER_TTL_MS), updatedAt: now } },
    { session },
  );
}

/**
 * Expire offers whose deadline has passed and offer the slot to the next user.
 * Called periodically by the server and on a user's waitlist read.
 */
export async function processExpiredOffers(userId?: ObjectId): Promise<number> {
  const now = new Date();
  const stale = await waitlist
    .find({ ...(userId ? { userId } : {}), status: 'offered', offerExpiresAt: { $lte: now } })
    .limit(100)
    .toArray();

  for (const entry of stale) {
    await withTransaction(async (session) => {
      await touchSlot(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
      const current = await waitlist.findOne({ _id: entry._id }, { session });
      if (!current || current.status !== 'offered' || !current.offerExpiresAt || current.offerExpiresAt > new Date()) return;
      await waitlist.updateOne(
        { _id: entry._id, status: 'offered' },
        { $set: { status: 'expired', updatedAt: new Date() }, $unset: { offerExpiresAt: '' } },
        { session },
      );
      await promoteWaitlist(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
    });
  }
  return stale.length;
}
