import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ObjectId } from 'mongodb';
import { ApiError } from '../src/http.js';
import {
  cancelReservation,
  createReservation,
  getReservation,
  listReservations,
  settlePastReservations,
  updateReservation,
} from '../src/features/reservations/service.js';
import { reservations } from '../src/features/reservations/model.js';
import {
  FUTURE_DATE,
  SLOT_TIME,
  cleanupRestaurant,
  connect,
  disconnect,
  makeAuth,
  seedRestaurant,
} from './helpers.int.js';

function base(restaurantId: string) {
  return {
    restaurantId,
    reservationDate: FUTURE_DATE,
    reservationTime: SLOT_TIME,
    partySize: 2,
    tablesRequested: 1,
  };
}

describe('reservations — capacity & authorization', () => {
  before(connect);
  after(disconnect);

  test('double booking a full slot is rejected with 409 SLOT_FULL', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      await createReservation(makeAuth(), base(restaurantId));
      await assert.rejects(
        () => createReservation(makeAuth(), base(restaurantId)),
        (err: unknown) => err instanceof ApiError && err.status === 409 && err.code === 'SLOT_FULL',
      );
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('concurrent bookings of a 1-table slot: exactly one wins', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      const results = await Promise.allSettled([
        createReservation(makeAuth(), base(restaurantId)),
        createReservation(makeAuth(), base(restaurantId)),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      assert.equal(fulfilled.length, 1, 'exactly one booking should succeed');
      assert.equal(rejected.length, 1, 'the other should fail');
      const reason = (rejected[0] as PromiseRejectedResult).reason;
      assert.ok(reason instanceof ApiError && reason.status === 409);
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('a second table is free when capacity allows it', async () => {
    const restaurantId = await seedRestaurant(2);
    try {
      const first = await createReservation(makeAuth(), base(restaurantId));
      const second = await createReservation(makeAuth(), base(restaurantId));
      assert.equal(first.status, 'confirmed');
      assert.equal(second.status, 'confirmed');
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('party size must fit the requested tables', async () => {
    const restaurantId = await seedRestaurant(2);
    try {
      await assert.rejects(
        () => createReservation(makeAuth(), { ...base(restaurantId), partySize: 5 }),
        (err: unknown) => err instanceof ApiError && err.status === 400 && err.code === 'PARTY_TOO_LARGE',
      );
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('past history includes cancelled bookings and completion is visible globally', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      const owner = makeAuth();
      const now = new Date();
      await reservations.insertMany([
        { userId: owner.userId, restaurantId: new ObjectId(restaurantId), reservationDate: '2020-01-01', reservationTime: '18:00', partySize: 2, tablesRequested: 1, status: 'cancelled', createdAt: now, updatedAt: now },
        { userId: owner.userId, restaurantId: new ObjectId(restaurantId), reservationDate: '2020-01-02', reservationTime: '18:00', partySize: 2, tablesRequested: 1, status: 'confirmed', createdAt: now, updatedAt: now },
      ]);
      const past = await listReservations(owner, { when: 'past' });
      assert.deepEqual(new Set(past.map((item) => item.status)), new Set(['cancelled', 'completed']));
      const cancelled = await listReservations(owner, { when: 'past', status: 'cancelled' });
      assert.equal(cancelled.length, 1);
      await reservations.insertOne({ userId: makeAuth().userId, restaurantId: new ObjectId(restaurantId), reservationDate: '2020-01-03', reservationTime: '18:00', partySize: 2, tablesRequested: 1, status: 'confirmed', createdAt: now, updatedAt: now });
      await settlePastReservations();
      assert.equal(await reservations.countDocuments({ restaurantId: new ObjectId(restaurantId), status: 'completed' }), 2);
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('a non-owner cannot view or edit the reservation (403)', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      const owner = makeAuth();
      const created = await createReservation(owner, base(restaurantId));
      const stranger = makeAuth();
      await assert.rejects(
        () => getReservation(stranger, created.id),
        (err: unknown) => err instanceof ApiError && err.status === 403,
      );
      await assert.rejects(
        () => updateReservation(stranger, created.id, { partySize: 4 }),
        (err: unknown) => err instanceof ApiError && err.status === 403,
      );
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('an admin can edit and cancel any reservation', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      const owner = makeAuth();
      const created = await createReservation(owner, base(restaurantId));
      const admin = makeAuth('admin');

      const edited = await updateReservation(admin, created.id, { partySize: 4 });
      assert.equal(edited.partySize, 4);

      await cancelReservation(admin, created.id);
      const afterCancel = await getReservation(owner, created.id);
      assert.equal(afterCancel.status, 'cancelled');
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });
});
