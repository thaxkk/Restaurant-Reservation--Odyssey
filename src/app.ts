import express from 'express';
import { db } from './db.js';
import { adminRouter } from './features/admin/routes.js';
import { authRouter } from './features/auth/routes.js';
import { restaurantRouter } from './features/restaurants/routes.js';
import { reservationsRouter } from './features/reservations/routes.js';
import { waitlistRouter } from './features/waitlist/routes.js';
import { errorHandler, notFound } from './http.js';

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

// Member A — identity, restaurants, admin query.
app.use('/api/auth', authRouter);
app.use('/api/restaurants', restaurantRouter);
app.use('/api/admin', adminRouter);

// Member B — reservations and waitlist.
app.use('/api/reservations', reservationsRouter);
app.use('/api/waitlist', waitlistRouter);

app.use(notFound);
app.use(errorHandler);
