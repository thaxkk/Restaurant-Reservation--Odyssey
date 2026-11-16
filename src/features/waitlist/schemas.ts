import { z } from 'zod';
import { isValidCalendarDate } from '../../time.js';

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine(isValidCalendarDate, 'Invalid calendar date');

const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm');
const objectIdStr = z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid id');

export const joinWaitlistSchema = z.object({
  restaurantId: objectIdStr,
  reservationDate: dateStr,
  reservationTime: timeStr,
  partySize: z.number().int().min(1),
  tablesRequested: z.number().int().min(1).max(3),
});

export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;
