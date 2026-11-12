import assert from 'node:assert/strict';
import test from 'node:test';
import { registerSchema } from '../src/features/auth/schemas.js';

test('public registration rejects a supplied admin role', () => {
  const result = registerSchema.safeParse({
    name: 'Ada', telephone: '0812345678', email: 'ADA@example.com', password: 'secure-password', role: 'admin',
  });
  assert.equal(result.success, false);
});

test('registration normalizes email for unique account lookup', () => {
  const result = registerSchema.parse({
    name: 'Ada', telephone: '0812345678', email: 'ADA@example.com', password: 'secure-password',
  });
  assert.equal(result.email, 'ada@example.com');
});
