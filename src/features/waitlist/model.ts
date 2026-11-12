import { ObjectId, type WithId } from 'mongodb';
import { db } from '../../db.js';

export type WaitlistStatus = 'waiting' | 'offered' | 'accepted' | 'expired' | 'cancelled';

export interface WaitlistEntry {
  userId: ObjectId;
  restaurantId: ObjectId;
  reservationDate: string;
  reservationTime: string;
  partySize: number;
  tablesRequested: number;
  status: WaitlistStatus;
  offerExpiresAt?: Date; // set while status === 'offered'
  createdAt: Date;
  updatedAt: Date;
}

/** Minutes a FIFO offer stays open before it expires and rolls to the next entry. */
export const OFFER_TTL_MS = 15 * 60 * 1000;

export const waitlist = db.collection<WaitlistEntry>('waitlist_entries');

export function publicWaitlistEntry(e: WithId<WaitlistEntry>) {
  return {
    id: e._id.toHexString(),
    restaurantId: e.restaurantId.toHexString(),
    reservationDate: e.reservationDate,
    reservationTime: e.reservationTime,
    partySize: e.partySize,
    tablesRequested: e.tablesRequested,
    status: e.status,
    offerExpiresAt: e.offerExpiresAt ? e.offerExpiresAt.toISOString() : null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
