import express from 'express';
import { db } from './db.js';
import { errorHandler, notFound } from './http.js';
import { reservationsRouter } from './features/reservations/routes.js';
import { waitlistRouter } from './features/waitlist/routes.js';

export const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health/ready', async (_req, res, next) => {
  try {
    await db.command({ ping: 1 });
    res.json({ status: 'ready' });
  } catch (error) {
    next(error);
  }
});

// Member B feature routers. At integration, add Member A's auth/restaurants/
// admin routers here too (and keep her shared http.ts / auth middleware).
app.use('/api/reservations', reservationsRouter);
app.use('/api/waitlist', waitlistRouter);

app.use(notFound);
app.use(errorHandler);
