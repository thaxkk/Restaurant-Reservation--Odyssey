import { Router } from 'express';
import { ObjectId, type Document } from 'mongodb';
import { z } from 'zod';
import { db } from '../../db.js';
import { ApiError, parse } from '../../http.js';
import { requireAdmin, requireAuth } from '../auth/middleware.js';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Invalid date');

const querySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  date: dateSchema.optional(),
  status: z.enum(['confirmed', 'cancelled', 'completed']).optional(),
  restaurantId: z.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  restaurantName: z.string().trim().min(1).max(100).optional(),
  sortBy: z.enum(['date', 'createdAt']).default('date'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const adminRouter = Router();

adminRouter.get('/reservations', requireAuth, requireAdmin, async (req, res) => {
  const query = parse(querySchema, req.query);
  const direction = query.order === 'asc' ? 1 : -1;
  const match: Document = {};
  if (query.date) match.reservationDate = query.date;
  if (query.status) match.status = query.status;
  if (query.restaurantId) match.restaurantId = new ObjectId(query.restaurantId);

  const pipeline: Document[] = [
    { $match: match },
    { $lookup: { from: 'restaurants', localField: 'restaurantId', foreignField: '_id', as: 'restaurant' } },
    { $unwind: { path: '$restaurant', preserveNullAndEmptyArrays: true } },
  ];
  if (query.restaurantName) {
    const escaped = query.restaurantName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pipeline.push({ $match: { 'restaurant.name': { $regex: escaped, $options: 'i' } } });
  }
  pipeline.push(
    { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $facet: {
      items: [
        { $sort: query.sortBy === 'date' ? { reservationDate: direction, reservationTime: direction, _id: direction } : { createdAt: direction, _id: direction } },
        { $skip: (query.page - 1) * query.limit },
        { $limit: query.limit },
        { $project: { user: { _id: 1, name: 1, email: 1 }, restaurant: { _id: 1, name: 1 }, userId: 1, restaurantId: 1, reservationDate: 1, reservationTime: 1, partySize: 1, tablesRequested: 1, status: 1, createdAt: 1, updatedAt: 1 } },
      ],
      count: [{ $count: 'total' }],
    } },
  );

  const [result] = await db.collection('reservations').aggregate<{
    items: Array<Document & { _id: ObjectId; userId: ObjectId; restaurantId: ObjectId }>;
    count: Array<{ total: number }>;
  }>(pipeline).toArray();
  if (!result) throw new ApiError(500, 'INTERNAL_ERROR', 'Could not query reservations');
  const items = result.items.map((item) => ({
    id: item._id.toHexString(),
    userId: item.userId.toHexString(),
    restaurantId: item.restaurantId.toHexString(),
    user: item.user?._id ? { id: item.user._id.toHexString(), name: item.user.name, email: item.user.email } : null,
    restaurant: item.restaurant?._id ? { id: item.restaurant._id.toHexString(), name: item.restaurant.name } : null,
    reservationDate: item.reservationDate,
    reservationTime: item.reservationTime,
    partySize: item.partySize,
    tablesRequested: item.tablesRequested,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }));
  res.json({ items, page: query.page, limit: query.limit, total: result.count[0]?.total ?? 0 });
});

