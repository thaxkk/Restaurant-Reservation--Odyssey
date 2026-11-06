import type { RequestHandler, Response } from 'express';
import { ObjectId } from 'mongodb';
import { ApiError } from '../../http.js';
import { sessions, tokenHash, users, type Role } from './sessions.js';

export interface AuthContext {
  userId: ObjectId;
  role: Role;
  email: string;
  sessionId: ObjectId;
}

export function getAuth(res: Response): AuthContext {
  const auth = res.locals.auth as AuthContext | undefined;
  if (!auth) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
  return auth;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.header('authorization');
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? '');
  if (!match) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');

  const session = await sessions.findOne({ tokenHash: tokenHash(match[1]!), expiresAt: { $gt: new Date() } });
  if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired session');
  const user = await users.findOne({ _id: session.userId });
  if (!user) throw new ApiError(401, 'UNAUTHORIZED', 'Invalid session');

  res.locals.auth = { userId: user._id, role: user.role, email: user.email, sessionId: session._id } satisfies AuthContext;
  next();
};

export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (getAuth(res).role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Admin access required');
  next();
};
