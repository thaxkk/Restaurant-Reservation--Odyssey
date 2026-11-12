// Shared helpers for the integration tests (files named *.int.ts).
//
// These exercise the real transactional booking/waitlist logic, so they need a
// MongoDB that supports multi-document transactions (an Atlas cluster or any
// replica set). Point MONGODB_URI at such a cluster and run `npm run
// test:integration`. Importing this module pulls in src/config, which requires
// MONGODB_URI — so these never run under the plain `npm test` unit suite.
import { ObjectId } from 'mongodb';
import { client, db } from '../src/db.js';
import type { AuthContext } from '../src/features/auth/middleware.js';

/** A synthetic auth context — the services only read userId and role. */
export function makeAuth(role: 'user' | 'admin' = 'user'): AuthContext {
  const userId = new ObjectId();
  return { userId, role, email: `${userId.toHexString()}@test.local`, sessionId: new ObjectId() };
}

/** Insert a restaurant directly (bypasses Member A's admin API) and return its id. */
export async function seedRestaurant(totalTables = 1): Promise<string> {
  const now = new Date();
  const { insertedId } = await db.collection('restaurants').insertOne({
    name: `IT Restaurant ${new ObjectId().toHexString()}`,
    address: 'Test Address',
    telephone: '020000000',
    opensAt: '00:00',
    closesAt: '23:59',
    totalTables,
    createdAt: now,
    updatedAt: now,
  });
  return insertedId.toHexString();
}

/** Remove everything created for a restaurant so reruns stay deterministic. */
export async function cleanupRestaurant(restaurantId: string): Promise<void> {
  const _id = new ObjectId(restaurantId);
  await Promise.all([
    db.collection('restaurants').deleteOne({ _id }),
    db.collection('reservations').deleteMany({ restaurantId: _id }),
    db.collection('waitlist_entries').deleteMany({ restaurantId: _id }),
    db.collection('reservation_slots').deleteMany({ restaurantId: _id }),
  ]);
}

/** A slot comfortably in the future so date/time validation always passes. */
export const FUTURE_DATE = '2099-01-01';
export const SLOT_TIME = '18:00';

export async function connect(): Promise<void> {
  await client.connect();
}

export async function disconnect(): Promise<void> {
  await client.close();
}
