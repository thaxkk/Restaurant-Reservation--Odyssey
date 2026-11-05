import { Router } from 'express';
import { MongoServerError } from 'mongodb';
import { ApiError, parse } from '../../http.js';
import { getAuth, requireAuth } from './middleware.js';
import { hashPassword, verifyPassword } from './password.js';
import { loginSchema, registerSchema } from './schemas.js';
import { createSession, publicUser, sessions, users } from './sessions.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const body = parse(registerSchema, req.body);
  const now = new Date();
  const passwordHash = await hashPassword(body.password);
  try {
    const result = await users.insertOne({
      name: body.name,
      telephone: body.telephone,
      email: body.email,
      passwordHash,
      role: 'user',
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ user: { id: result.insertedId.toHexString(), name: body.name, telephone: body.telephone, email: body.email, role: 'user' } });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) throw new ApiError(409, 'EMAIL_EXISTS', 'Email already registered');
    throw error;
  }
});

authRouter.post('/login', async (req, res) => {
  const body = parse(loginSchema, req.body);
  const user = await users.findOne({ email: body.email });
  if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  const session = await createSession(user._id);
  res.set('Cache-Control', 'no-store');
  res.json({ token: session.token, tokenType: 'Bearer', expiresAt: session.expiresAt.toISOString(), user: publicUser(user) });
});

authRouter.post('/logout', requireAuth, async (_req, res) => {
  await sessions.deleteOne({ _id: getAuth(res).sessionId });
  res.status(204).send();
});

