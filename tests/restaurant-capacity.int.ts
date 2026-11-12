import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ObjectId } from 'mongodb';
import { ApiError } from '../src/http.js';
import { createReservation, cancelReservation } from '../src/features/reservations/service.js';
import { deleteRestaurantProfile, restaurants, updateRestaurantProfile } from '../src/features/restaurants/routes.js';
import { joinWaitlist, listWaitlist } from '../src/features/waitlist/service.js';
import { FUTURE_DATE, SLOT_TIME, cleanupRestaurant, connect, disconnect, makeAuth, seedRestaurant } from './helpers.int.js';

describe('restaurant capacity changes', () => {
  before(connect);
  after(disconnect);

  test('cannot reduce tables below existing bookings', async () => {
    const restaurantId = await seedRestaurant(2);
    try {
      const first = await createReservation(makeAuth(), { restaurantId, reservationDate: FUTURE_DATE, reservationTime: SLOT_TIME, partySize: 2, tablesRequested: 1 });
      await createReservation(makeAuth(), { restaurantId, reservationDate: FUTURE_DATE, reservationTime: SLOT_TIME, partySize: 2, tablesRequested: 1 });
      await assert.rejects(
        () => updateRestaurantProfile(new ObjectId(restaurantId), { totalTables: 1 }),
        (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === 'CAPACITY_IN_USE',
      );
      await cancelReservation(makeAuth('admin'), first.id);
      const updated = await updateRestaurantProfile(new ObjectId(restaurantId), { totalTables: 1 });
      assert.equal(updated.totalTables, 1);
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('cannot reduce seats below an existing party size', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      await createReservation(makeAuth(), { restaurantId, reservationDate: FUTURE_DATE, reservationTime: SLOT_TIME, partySize: 4, tablesRequested: 1 });
      await assert.rejects(
        () => updateRestaurantProfile(new ObjectId(restaurantId), { seatsPerTable: 2 }),
        (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === 'CAPACITY_IN_USE',
      );
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('increasing table capacity offers the first waiting entry', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      await createReservation(makeAuth(), { restaurantId, reservationDate: FUTURE_DATE, reservationTime: SLOT_TIME, partySize: 2, tablesRequested: 1 });
      const waiter = makeAuth();
      const entry = await joinWaitlist(waiter, { restaurantId, reservationDate: FUTURE_DATE, reservationTime: SLOT_TIME, partySize: 2, tablesRequested: 1 });
      await updateRestaurantProfile(new ObjectId(restaurantId), { totalTables: 2 });
      assert.equal((await listWaitlist(waiter)).find((item) => item.id === entry.id)?.status, 'offered');
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });

  test('deletion is blocked while future reservations still exist', async () => {
    const restaurantId = await seedRestaurant(1);
    try {
      const booking = await createReservation(makeAuth(), { restaurantId, reservationDate: FUTURE_DATE, reservationTime: SLOT_TIME, partySize: 2, tablesRequested: 1 });
      await assert.rejects(
        () => deleteRestaurantProfile(new ObjectId(restaurantId)),
        (error: unknown) => error instanceof ApiError && error.status === 409 && error.code === 'RESTAURANT_IN_USE',
      );
      await cancelReservation(makeAuth('admin'), booking.id);
      await deleteRestaurantProfile(new ObjectId(restaurantId));
      assert.ok((await restaurants.findOne({ _id: new ObjectId(restaurantId) }))?.deletedAt);
    } finally {
      await cleanupRestaurant(restaurantId);
    }
  });
});
