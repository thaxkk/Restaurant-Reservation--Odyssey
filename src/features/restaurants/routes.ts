import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { db } from '../../db.js';
import { ApiError, parse } from '../../http.js';
import { requireAdmin, requireAuth } from '../auth/middleware.js';

export interface Restaurant {
  name: string;
  address: string;
  telephone: string;
  opensAt: string;
  closesAt: string;
  totalTables: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

export const restaurants = db.collection<Restaurant>('restaurants');

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const restaurantSchema = z.strictObject({
  name: z.string().trim().min(1).max(150),
  address: z.string().trim().min(1).max(500),
  telephone: z.string().trim().min(7).max(30),
  opensAt: time,
  closesAt: time,
  totalTables: z.number().int().min(1).max(10000),
});
const updateSchema = restaurantSchema.partial().refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const listSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function restaurantId(value: string | string[] | undefined): ObjectId {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{24}$/.test(value)) throw new ApiError(400, 'INVALID_ID', 'Invalid restaurant ID');
  return new ObjectId(value);
}

function serialize(restaurant: Restaurant & { _id: ObjectId }) {
  const { _id, ...fields } = restaurant;
  return { id: _id.toHexString(), ...fields };
}

export const restaurantRouter = Router();

restaurantRouter.get('/', async (req, res) => {
  const { page, limit } = parse(listSchema, req.query);
  const filter = { deletedAt: { $exists: false } };
  const [items, total] = await Promise.all([
    restaurants.find(filter).sort({ name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).toArray(),
    restaurants.countDocuments(filter),
  ]);
  res.json({ items: items.map(serialize), page, limit, total });
});

restaurantRouter.get('/:id', async (req, res) => {
  const restaurant = await restaurants.findOne({ _id: restaurantId(req.params.id!), deletedAt: { $exists: false } });
  if (!restaurant) throw new ApiError(404, 'NOT_FOUND', 'Restaurant not found');
  res.json({ restaurant: serialize(restaurant) });
});

restaurantRouter.post('/', requireAuth, requireAdmin, async (req, res) => {
  const body = parse(restaurantSchema, req.body);
  if (body.opensAt === body.closesAt) throw new ApiError(400, 'VALIDATION_ERROR', 'Opening and closing times must differ');
  const now = new Date();
  const result = await restaurants.insertOne({ ...body, createdAt: now, updatedAt: now });
  res.status(201).json({ restaurant: serialize({ _id: result.insertedId, ...body, createdAt: now, updatedAt: now }) });
});

restaurantRouter.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const body = parse(updateSchema, req.body);
  const id = restaurantId(req.params.id!);
  const existing = await restaurants.findOne({ _id: id, deletedAt: { $exists: false } });
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Restaurant not found');
  if ((body.opensAt ?? existing.opensAt) === (body.closesAt ?? existing.closesAt)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Opening and closing times must differ');
  }
  const updated = await restaurants.findOneAndUpdate(
    { _id: id, deletedAt: { $exists: false } },
    { $set: { ...body, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Restaurant not found');
  res.json({ restaurant: serialize(updated) });
});

restaurantRouter.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  const now = new Date();
  const result = await restaurants.updateOne(
    { _id: restaurantId(req.params.id!), deletedAt: { $exists: false } },
    { $set: { deletedAt: now, updatedAt: now } },
  );
  if (result.matchedCount === 0) throw new ApiError(404, 'NOT_FOUND', 'Restaurant not found');
  res.status(204).send();
});
