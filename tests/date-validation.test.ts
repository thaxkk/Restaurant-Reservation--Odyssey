import assert from 'node:assert/strict';
import test from 'node:test';
import { createReservationSchema } from '../src/features/reservations/schemas.js';
import { joinWaitlistSchema } from '../src/features/waitlist/schemas.js';

test('booking and waitlist reject impossible dates', () => {
  const input = { restaurantId: '652000000000000000000099', reservationDate: '2026-02-31', reservationTime: '18:00', partySize: 2, tablesRequested: 1 };
  assert.equal(createReservationSchema.safeParse(input).success, false);
  assert.equal(joinWaitlistSchema.safeParse(input).success, false);
  assert.equal(createReservationSchema.safeParse({ ...input, reservationDate: '2028-02-29' }).success, true);
});
