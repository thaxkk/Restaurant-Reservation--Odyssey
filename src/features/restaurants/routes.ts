import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { db } from '../../db.js';
import { ApiError, parse } from '../../http.js';
import { requireAdmin, requireAuth } from '../auth/middleware.js';
import { withTransaction } from '../reservations/capacity.js';
import { reservations } from '../reservations/model.js';
import { waitlist } from '../waitlist/model.js';
import { promoteWaitlist } from '../waitlist/promotion.js';
import { bangkokNow, isPastSlot } from '../../time.js';

export interface Restaurant {
  name: string;
  address: string;
  telephone: string;
  opensAt: string;
  closesAt: string;
  totalTables: number;
  seatsPerTable?: number;
  capacityVersion?: number;
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
  seatsPerTable: z.number().int().min(1).max(100).optional(),
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
  const { _id, capacityVersion: _capacityVersion, ...fields } = restaurant;
  return { id: _id.toHexString(), ...fields };
}

type RestaurantUpdate = z.infer<typeof updateSchema>;

/** Reject capacity changes that would invalidate bookings or active waitlist requests. */
export async function updateRestaurantProfile(id: ObjectId, body: RestaurantUpdate) {
  return withTransaction(async (session) => {
    const existing = await restaurants.findOne({ _id: id, deletedAt: { $exists: false } }, { session });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Restaurant not found');
    if ((body.opensAt ?? existing.opensAt) === (body.closesAt ?? existing.closesAt)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Opening and closing times must differ');
    }

    const newCapacity = body.totalTables ?? existing.totalTables;
    const newSeats = body.seatsPerTable ?? existing.seatsPerTable ?? 4;
    if (newCapacity < existing.totalTables || newSeats < (existing.seatsPerTable ?? 4)) {
      const { date, time } = bangkokNow();
      const future = { $or: [{ reservationDate: { $gt: date } }, { reservationDate: date, reservationTime: { $gte: time } }] };
      const bookings = await reservations.find({ restaurantId: id, status: 'confirmed', ...future }, { session }).toArray();
      const usedBySlot = new Map<string, number>();
      for (const booking of bookings) {
        if (booking.partySize > booking.tablesRequested * newSeats) {
          throw new ApiError(409, 'CAPACITY_IN_USE', 'Existing party exceeds the proposed seating capacity');
        }
        const slot = `${booking.reservationDate}T${booking.reservationTime}`;
        const used = (usedBySlot.get(slot) ?? 0) + booking.tablesRequested;
        if (used > newCapacity) throw new ApiError(409, 'CAPACITY_IN_USE', 'Existing bookings exceed the proposed table capacity');
        usedBySlot.set(slot, used);
      }
      const queued = await waitlist.find({ restaurantId: id, status: { $in: ['waiting', 'offered'] } }, { session }).toArray();
      for (const entry of queued) {
        if (entry.tablesRequested > newCapacity || entry.partySize > entry.tablesRequested * newSeats) {
          throw new ApiError(409, 'CAPACITY_IN_USE', 'An active waitlist request exceeds the proposed capacity');
        }
        if (entry.status === 'offered') {
          throw new ApiError(409, 'ACTIVE_OFFER', 'Wait until active waitlist offers are resolved before reducing capacity');
        }
      }
    }

    const updated = await restaurants.findOneAndUpdate(
      { _id: id, deletedAt: { $exists: false } },
      { $set: { ...body, updatedAt: new Date() } },
      { returnDocument: 'after', session },
    );
    if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Restaurant not found');
    if (newCapacity > existing.totalTables) {
      const waiting = await waitlist.find({ restaurantId: id, status: 'waiting' }, { session }).toArray();
      const seen = new Set<string>();
      for (const entry of waiting) {
        const slot = `${entry.reservationDate}T${entry.reservationTime}`;
        if (seen.has(slot) || isPastSlot(entry.reservationDate, entry.reservationTime)) continue;
        seen.add(slot);
        await promoteWaitlist(session, id, entry.reservationDate, entry.reservationTime);
      }
    }
    return updated;
  });
}

/** Keep future bookings and waiting users attached to an active restaurant. */
export async function deleteRestaurantProfile(id: ObjectId): Promise<void> {
  await withTransaction(async (session) => {
    const existing = await restaurants.findOne({ _id: id, deletedAt: { $exists: false } }, { session });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Restaurant not found');
    const { date, time } = bangkokNow();
    const futureBookings = await reservations.countDocuments(
      { restaurantId: id, status: 'confirmed', $or: [{ reservationDate: { $gt: date } }, { reservationDate: date, reservationTime: { $gte: time } }] },
      { session },
    );
    const activeQueue = await waitlist.countDocuments(
      { restaurantId: id, status: { $in: ['waiting', 'offered'] } },
      { session },
    );
    if (futureBookings > 0 || activeQueue > 0) {
      throw new ApiError(409, 'RESTAURANT_IN_USE', 'Cancel future reservations and waitlist entries before deleting this restaurant');
    }
    await restaurants.updateOne(
      { _id: id, deletedAt: { $exists: false } },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } },
      { session },
    );
  });
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
  const doc = { ...body, seatsPerTable: body.seatsPerTable ?? 4, createdAt: now, updatedAt: now };
  const result = await restaurants.insertOne(doc);
  res.status(201).json({ restaurant: serialize({ _id: result.insertedId, ...doc }) });
});

restaurantRouter.patch('/:id', requireAuth, requireAdmin, async (req, res) => {
  const body = parse(updateSchema, req.body);
  const id = restaurantId(req.params.id!);
  const updated = await updateRestaurantProfile(id, body);
  res.json({ restaurant: serialize(updated) });
});

restaurantRouter.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  await deleteRestaurantProfile(restaurantId(req.params.id!));
  res.status(204).send();
});
