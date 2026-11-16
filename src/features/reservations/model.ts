import { ObjectId, type WithId } from 'mongodb';
import { db } from '../../db.js';

export type ReservationStatus = 'confirmed' | 'cancelled' | 'completed';

export interface Reservation {
  userId: ObjectId;
  restaurantId: ObjectId;
  reservationDate: string; // YYYY-MM-DD
  reservationTime: string; // HH:mm
  partySize: number;
  tablesRequested: number; // 1..3 per booking
  status: ReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

// Read-only view of the restaurant document (owned by Member A). We only read
// the fields booking logic needs. `deletedAt` marks a soft-deleted restaurant.
export interface Restaurant {
  name: string;
  address: string;
  telephone: string;
  opensAt: string;
  closesAt: string;
  totalTables: number;
  seatsPerTable?: number;
  capacityVersion?: number;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Per-slot guard document. Bumping its `version` inside a transaction creates a
// write-write conflict between concurrent bookings of the same slot, so the
// capacity check and insert are effectively serialized (losers retry).
export interface SlotGuard {
  restaurantId: ObjectId;
  reservationDate: string;
  reservationTime: string;
  version: number;
}

export const reservations = db.collection<Reservation>('reservations');
export const restaurants = db.collection<Restaurant>('restaurants');
export const reservationSlots = db.collection<SlotGuard>('reservation_slots');

export function publicReservation(r: WithId<Reservation>) {
  return {
    id: r._id.toHexString(),
    restaurantId: r.restaurantId.toHexString(),
    reservationDate: r.reservationDate,
    reservationTime: r.reservationTime,
    partySize: r.partySize,
    tablesRequested: r.tablesRequested,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
