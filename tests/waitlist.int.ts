import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ApiError } from '../src/http.js';
import { createReservation, cancelReservation } from '../src/features/reservations/service.js';
import {
  acceptWaitlistOffer,
  joinWaitlist,
  listWaitlist,
} from '../src/features/waitlist/service.js';
import {
  FUTURE_DATE,
  SLOT_TIME,
  cleanupRestaurant,
  connect,
  disconnect,
  makeAuth,
  seedRestaurant,
} from './helpers.int.js';

function slot(restaurantId: string) {
  return {
    restaurantId,
    reservationDate: FUTURE_DATE,
    reservationTime: SLOT_TIME,
    partySize: 2,
    tablesRequested: 1,
  };
}

describe('waitlist — FIFO offers on capacity release', () => {
  before(connect);
  after(disconnect);

  test('join is refused when the slot still has capacity (409 SLOT_AVAILABLE)', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      await assert.rejects(
        () => joinWaitlist(makeAuth(), slot(restaurantId)),
        (err: unknown) => err instanceof ApiError && err.status === 409 && err.code === 'SLOT_AVAILABLE',
      );
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('cancellation promotes the earliest waiting entry, who can accept', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      const owner = makeAuth();
      const booking = await createReservation(owner, slot(restaurantId));

      // Two users queue in order on the now-full slot.
      const first = makeAuth();
      const second = makeAuth();
      const firstEntry = await joinWaitlist(first, slot(restaurantId));
      await joinWaitlist(second, slot(restaurantId));

      // Owner cancels — one table frees, the earliest entry gets the offer.
      await cancelReservation(owner, booking.id);

      const firstList = await listWaitlist(first);
      const firstView = firstList.find((e) => e.id === firstEntry.id);
      assert.equal(firstView?.status, 'offered', 'first in line should be offered');
      assert.ok(firstView?.offerExpiresAt, 'offer should carry an expiry');

      const secondList = await listWaitlist(second);
      assert.equal(secondList[0]?.status, 'waiting', 'second in line should still wait');

      // Accepting the offer yields a confirmed reservation.
      const reservation = await acceptWaitlistOffer(first, firstEntry.id);
      assert.equal(reservation.status, 'confirmed');
      assert.equal(reservation.restaurantId, restaurantId);
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('duplicate active join by the same user is rejected (409 ALREADY_WAITING)', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      const owner = makeAuth();
      await createReservation(owner, slot(restaurantId)); // fill the slot

      const waiter = makeAuth();
      await joinWaitlist(waiter, slot(restaurantId));
      await assert.rejects(
        () => joinWaitlist(waiter, slot(restaurantId)),
        (err: unknown) => err instanceof ApiError && err.status === 409 && err.code === 'ALREADY_WAITING',
      );
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });
});
