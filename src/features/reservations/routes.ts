import { Router } from 'express';
import { parse } from '../../http.js';
import { getAuth, requireAuth } from '../auth/middleware.js';
import {
  cancelReservation,
  createReservation,
  getReservation,
  listReservations,
  updateReservation,
} from './service.js';
import {
  createReservationSchema,
  listReservationsQuerySchema,
  updateReservationSchema,
} from './schemas.js';

export const reservationsRouter = Router();

reservationsRouter.use(requireAuth);

// POST /api/reservations — create a reservation (409 SLOT_FULL when full).
reservationsRouter.post('/', async (req, res) => {
  const input = parse(createReservationSchema, req.body);
  const reservation = await createReservation(getAuth(res), input);
  res.status(201).json(reservation);
});

// GET /api/reservations — own reservation history with status/when/date filters.
reservationsRouter.get('/', async (req, res) => {
  const query = parse(listReservationsQuerySchema, req.query);
  const items = await listReservations(getAuth(res), query);
  res.json({ items });
});

// GET /api/reservations/:id — owner or admin.
reservationsRouter.get('/:id', async (req, res) => {
  const reservation = await getReservation(getAuth(res), req.params.id);
  res.json(reservation);
});

// PATCH /api/reservations/:id — owner or admin; rechecks capacity.
reservationsRouter.patch('/:id', async (req, res) => {
  const input = parse(updateReservationSchema, req.body);
  const reservation = await updateReservation(getAuth(res), req.params.id, input);
  res.json(reservation);
});

// DELETE /api/reservations/:id — cancel (retains history), promotes waitlist.
reservationsRouter.delete('/:id', async (req, res) => {
  await cancelReservation(getAuth(res), req.params.id);
  res.status(204).send();
});
