import { client, db } from '../src/db.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run admin:grant -- admin@example.com');
  process.exit(1);
}

try {
  await client.connect();
  const result = await db.collection('users').updateOne({ email }, { $set: { role: 'admin', updatedAt: new Date() } });
  if (result.matchedCount === 0) {
    console.error('User not found. Register this account first.');
    process.exitCode = 1;
  } else {
    console.log('Admin role granted to the existing account.');
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.close();
}
