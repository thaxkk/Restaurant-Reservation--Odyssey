import { createHash, randomBytes } from 'node:crypto';
import { ObjectId, type WithId } from 'mongodb';
import { db } from '../../db.js';

export type Role = 'user' | 'admin';

export interface User {
  name: string;
  telephone: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

interface Session {
  tokenHash: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

export const users = db.collection<User>('users');
export const sessions = db.collection<Session>('sessions');

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: ObjectId): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await sessions.insertOne({ tokenHash: tokenHash(token), userId, createdAt: now, expiresAt });
  return { token, expiresAt };
}

export function publicUser(user: WithId<User>) {
  return { id: user._id.toHexString(), name: user.name, telephone: user.telephone, email: user.email, role: user.role };
}

