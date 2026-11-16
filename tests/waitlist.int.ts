import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ObjectId } from 'mongodb';
import { ApiError } from '../src/http.js';
import { createReservation, cancelReservation } from '../src/features/reservations/service.js';
import { waitlist } from '../src/features/waitlist/model.js';
import { processExpiredOffers } from '../src/features/waitlist/promotion.js';
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

  test('a request larger than the restaurant can hold cannot enter the queue', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      await createReservation(makeAuth(), slot(restaurantId));
      await assert.rejects(
        () => joinWaitlist(makeAuth(), { ...slot(restaurantId), tablesRequested: 2 }),
        (error: unknown) => error instanceof ApiError && error.status === 400 && error.code === 'REQUEST_EXCEEDS_CAPACITY',
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

  test('an active offer reserves the slot against direct bookings', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      const owner = makeAuth();
      const booking = await createReservation(owner, slot(restaurantId));
      const waiter = makeAuth();
      const entry = await joinWaitlist(waiter, slot(restaurantId));
      await cancelReservation(owner, booking.id);
      await assert.rejects(
        () => createReservation(makeAuth(), slot(restaurantId)),
        (err: unknown) => err instanceof ApiError && err.status === 409 && err.code === 'WAITLIST_PRIORITY',
      );
      assert.equal((await acceptWaitlistOffer(waiter, entry.id)).status, 'confirmed');
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('the queue never skips a larger earlier request', async () => {
    const restaurantId = await seedRestaurant(2);
    try {
      const firstBooking = await createReservation(makeAuth(), slot(restaurantId));
      const secondBooking = await createReservation(makeAuth(), slot(restaurantId));
      const first = makeAuth();
      const second = makeAuth();
      const firstEntry = await joinWaitlist(first, { ...slot(restaurantId), tablesRequested: 2 });
      const secondEntry = await joinWaitlist(second, slot(restaurantId));

      await cancelReservation(makeAuth('admin'), firstBooking.id);
      assert.equal((await listWaitlist(first)).find((e) => e.id === firstEntry.id)?.status, 'waiting');
      assert.equal((await listWaitlist(second)).find((e) => e.id === secondEntry.id)?.status, 'waiting');
      await assert.rejects(
        () => createReservation(makeAuth(), slot(restaurantId)),
        (err: unknown) => err instanceof ApiError && err.code === 'WAITLIST_PRIORITY',
      );
      await cancelReservation(makeAuth('admin'), secondBooking.id);
      assert.equal((await listWaitlist(first)).find((e) => e.id === firstEntry.id)?.status, 'offered');
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('accepting an expired offer commits expiry and promotes the next user', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      const owner = makeAuth();
      const booking = await createReservation(owner, slot(restaurantId));
      const first = makeAuth();
      const second = makeAuth();
      const firstEntry = await joinWaitlist(first, slot(restaurantId));
      const secondEntry = await joinWaitlist(second, slot(restaurantId));
      await cancelReservation(owner, booking.id);
      await waitlist.updateOne({ _id: new ObjectId(firstEntry.id) }, { $set: { offerExpiresAt: new Date(Date.now() - 1000) } });

      await assert.rejects(
        () => acceptWaitlistOffer(first, firstEntry.id),
        (err: unknown) => err instanceof ApiError && err.code === 'OFFER_EXPIRED',
      );
      assert.equal((await listWaitlist(first)).find((e) => e.id === firstEntry.id)?.status, 'expired');
      assert.equal((await listWaitlist(second)).find((e) => e.id === secondEntry.id)?.status, 'offered');
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('the expiry worker advances an offer without user activity', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      const owner = makeAuth();
      const booking = await createReservation(owner, slot(restaurantId));
      const first = makeAuth();
      const second = makeAuth();
      const firstEntry = await joinWaitlist(first, slot(restaurantId));
      const secondEntry = await joinWaitlist(second, slot(restaurantId));
      await cancelReservation(owner, booking.id);
      await waitlist.updateOne({ _id: new ObjectId(firstEntry.id) }, { $set: { offerExpiresAt: new Date(Date.now() - 1000) } });

      await processExpiredOffers();
      assert.equal((await waitlist.findOne({ _id: new ObjectId(firstEntry.id) }))?.status, 'expired');
      assert.equal((await waitlist.findOne({ _id: new ObjectId(secondEntry.id) }))?.status, 'offered');
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });
});
