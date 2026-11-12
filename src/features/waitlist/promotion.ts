// FIFO promotion + offer expiry. Kept separate from waitlist/service.ts so the
// reservations feature can trigger promotion on cancel/edit without importing
// the waitlist service (avoids an import cycle). Depends only on the shared
// capacity primitives and the waitlist model.
import { ObjectId, type ClientSession } from 'mongodb';
import { bookedTables } from '../reservations/capacity.js';
import { restaurants } from '../reservations/model.js';
import { OFFER_TTL_MS, waitlist } from './model.js';

/**
 * Offer any free capacity in a slot to the earliest eligible waiting entry.
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
  const outstanding = await waitlist.findOne(
    { restaurantId, reservationDate: date, reservationTime: time, status: 'offered' },
    { session },
  );
  if (outstanding) return;

  const restaurant = await restaurants.findOne({ _id: restaurantId }, { session });
  if (!restaurant) return;

  const available = restaurant.totalTables - (await bookedTables(session, restaurantId, date, time));
  if (available <= 0) return;

  // Earliest waiting entry that fits the freed capacity (FIFO by createdAt, _id).
  const next = await waitlist.findOne(
    {
      restaurantId,
      reservationDate: date,
      reservationTime: time,
      status: 'waiting',
      tablesRequested: { $lte: available },
    },
    { session, sort: { createdAt: 1, _id: 1 } },
  );
  if (!next) return;

  const now = new Date();
  await waitlist.updateOne(
    { _id: next._id },
    { $set: { status: 'offered', offerExpiresAt: new Date(now.getTime() + OFFER_TTL_MS), updatedAt: now } },
    { session },
  );
}

/**
 * Expire offers whose deadline has passed and roll each freed slot to the next
 * waiting entry. Scoped to a single user's entries (called lazily on their reads
 * and before they accept) so there is no unbounded background sweep.
 */
export async function expireStaleOffers(
  session: ClientSession,
  userId: ObjectId,
): Promise<void> {
  const now = new Date();
  const stale = await waitlist
    .find({ userId, status: 'offered', offerExpiresAt: { $lte: now } }, { session })
    .toArray();

  for (const entry of stale) {
    await waitlist.updateOne(
      { _id: entry._id, status: 'offered' },
      { $set: { status: 'expired', updatedAt: now }, $unset: { offerExpiresAt: '' } },
      { session },
    );
    await promoteWaitlist(session, entry.restaurantId, entry.reservationDate, entry.reservationTime);
  }
}
