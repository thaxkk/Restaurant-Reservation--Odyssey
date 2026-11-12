import { Router } from 'express';
import { parse } from '../../http.js';
import { getAuth, requireAuth } from '../auth/middleware.js';
import {
  acceptWaitlistOffer,
  joinWaitlist,
  leaveWaitlist,
  listWaitlist,
} from './service.js';
import { joinWaitlistSchema } from './schemas.js';

export const waitlistRouter = Router();

waitlistRouter.use(requireAuth);

// POST /api/waitlist — join a full slot's FIFO queue.
waitlistRouter.post('/', async (req, res) => {
  const input = parse(joinWaitlistSchema, req.body);
  const entry = await joinWaitlist(getAuth(res), input);
  res.status(201).json(entry);
});

// GET /api/waitlist — own waitlist entries and offers.
waitlistRouter.get('/', async (_req, res) => {
  const items = await listWaitlist(getAuth(res));
  res.json({ items });
});

// POST /api/waitlist/:id/accept — accept an open offer (becomes a reservation).
waitlistRouter.post('/:id/accept', async (req, res) => {
  const reservation = await acceptWaitlistOffer(getAuth(res), req.params.id);
  res.status(201).json(reservation);
});

// DELETE /api/waitlist/:id — leave the waitlist.
waitlistRouter.delete('/:id', async (req, res) => {
  await leaveWaitlist(getAuth(res), req.params.id);
  res.status(204).send();
});
