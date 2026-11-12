import { z } from 'zod';

export const registerSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  telephone: z.string().trim().min(7).max(30),
  email: z.email().max(254).transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
});

export const loginSchema = z.strictObject({
  email: z.email().transform((email) => email.toLowerCase()),
  password: z.string().max(128),
});
