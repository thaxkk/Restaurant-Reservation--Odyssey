import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiError } from '../src/http.js';
import {
  cancelReservation,
  createReservation,
  getReservation,
  updateReservation,
} from '../src/features/reservations/service.js';
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

      const edited = await updateReservation(admin, created.id, { partySize: 5 });
      assert.equal(edited.partySize, 5);

      await cancelReservation(admin, created.id);
      const afterCancel = await getReservation(owner, created.id);
      assert.equal(afterCancel.status, 'cancelled');
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });
});
