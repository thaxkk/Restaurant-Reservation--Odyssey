import { z } from 'zod';

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00+07:00`)), 'Invalid calendar date');

const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm');
const objectIdStr = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');
const partySize = z.number().int().min(1);
const tablesRequested = z.number().int().min(1).max(3); // up to 3 tables per booking

export const createReservationSchema = z.object({
  restaurantId: objectIdStr,
  reservationDate: dateStr,
  reservationTime: timeStr,
  partySize,
  tablesRequested,
});

export const updateReservationSchema = z
  .object({
    reservationDate: dateStr.optional(),
    reservationTime: timeStr.optional(),
    partySize: partySize.optional(),
    tablesRequested: tablesRequested.optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, 'Provide at least one field to update');

export const listReservationsQuerySchema = z.object({
  status: z.enum(['confirmed', 'cancelled', 'completed']).optional(),
  when: z.enum(['past', 'upcoming']).optional(),
  date: dateStr.optional(),
  restaurantId: objectIdStr.optional(),
});

export type CreateReservationInput = z.infer<typeof createReservationSchema>;
export type UpdateReservationInput = z.infer<typeof updateReservationSchema>;
export type ListReservationsQuery = z.infer<typeof listReservationsQuerySchema>;
