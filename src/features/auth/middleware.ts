// ─────────────────────────────────────────────────────────────────────────────
// INTEGRATION STUB (Member B) — NOT the real auth.
//
// Member A owns the real version of this file on branch
// `feature/auth-restaurants-admin`. It validates a `Bearer` token against the
// `sessions` collection and sets `res.locals.auth`.
//
// This stub exposes the SAME interface (AuthContext / getAuth / requireAuth /
// requireAdmin) so the reservations and waitlist modules compile and can be
// tested standalone before integration. Instead of real tokens it trusts dev
// headers:
//     x-dev-user-id : 24-char hex ObjectId of the acting user   (required)
//     x-dev-role    : "admin" to act as admin, otherwise "user"  (optional)
//     x-dev-email   : email to put in the auth context           (optional)
//
// AT MERGE: delete this file and keep Member A's middleware.ts. The feature
// modules import only { AuthContext, getAuth, requireAuth, requireAdmin } from
// here, all of which her version also exports, so no feature code changes.
// ─────────────────────────────────────────────────────────────────────────────
import type { RequestHandler, Response } from 'express';
import { ObjectId } from 'mongodb';
import { ApiError } from '../../http.js';

export type Role = 'user' | 'admin';

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

export const requireAuth: RequestHandler = (req, res, next) => {
  const id = req.header('x-dev-user-id');
  if (!id || !ObjectId.isValid(id)) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required (dev stub: set x-dev-user-id header)');
  }
  const role: Role = req.header('x-dev-role') === 'admin' ? 'admin' : 'user';
  res.locals.auth = {
    userId: new ObjectId(id),
    role,
    email: req.header('x-dev-email') ?? 'dev@example.com',
    sessionId: new ObjectId(),
  } satisfies AuthContext;
  next();
};

export const requireAdmin: RequestHandler = (_req, res, next) => {
  if (getAuth(res).role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Admin access required');
  next();
};
