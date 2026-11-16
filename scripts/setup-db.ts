import { client, db } from '../src/db.js';

const collections = {
  users: {
    bsonType: 'object',
    required: ['name', 'telephone', 'email', 'passwordHash', 'role', 'createdAt', 'updatedAt'],
    properties: {
      name: { bsonType: 'string' },
      telephone: { bsonType: 'string' },
      email: { bsonType: 'string' },
      passwordHash: { bsonType: 'string' },
      role: { enum: ['user', 'admin'] },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
    },
  },
  sessions: {
    bsonType: 'object',
    required: ['tokenHash', 'userId', 'createdAt', 'expiresAt'],
    properties: {
      tokenHash: { bsonType: 'string' },
      userId: { bsonType: 'objectId' },
      createdAt: { bsonType: 'date' },
      expiresAt: { bsonType: 'date' },
    },
  },
  restaurants: {
    bsonType: 'object',
    required: ['name', 'address', 'telephone', 'opensAt', 'closesAt', 'totalTables', 'createdAt', 'updatedAt'],
    properties: {
      name: { bsonType: 'string' },
      address: { bsonType: 'string' },
      telephone: { bsonType: 'string' },
      opensAt: { bsonType: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
      closesAt: { bsonType: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
      totalTables: { bsonType: 'int', minimum: 1 },
      seatsPerTable: { bsonType: 'int', minimum: 1 },
      capacityVersion: { bsonType: 'int', minimum: 0 },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
      deletedAt: { bsonType: 'date' },
    },
  },
  reservations: {
    bsonType: 'object',
    required: ['userId', 'restaurantId', 'reservationDate', 'reservationTime', 'partySize', 'tablesRequested', 'status', 'createdAt', 'updatedAt'],
    properties: {
      userId: { bsonType: 'objectId' },
      restaurantId: { bsonType: 'objectId' },
      reservationDate: { bsonType: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      reservationTime: { bsonType: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
      partySize: { bsonType: 'int', minimum: 1 },
      tablesRequested: { bsonType: 'int', minimum: 1, maximum: 3 },
      status: { enum: ['confirmed', 'cancelled', 'completed'] },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
    },
  },
  reservation_slots: {
    bsonType: 'object',
    required: ['restaurantId', 'reservationDate', 'reservationTime', 'version'],
    properties: {
      restaurantId: { bsonType: 'objectId' },
      reservationDate: { bsonType: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      reservationTime: { bsonType: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
      version: { bsonType: 'int', minimum: 0 },
    },
  },
  waitlist_entries: {
    bsonType: 'object',
    required: ['userId', 'restaurantId', 'reservationDate', 'reservationTime', 'partySize', 'tablesRequested', 'status', 'createdAt', 'updatedAt'],
    properties: {
      userId: { bsonType: 'objectId' },
      restaurantId: { bsonType: 'objectId' },
      reservationDate: { bsonType: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      reservationTime: { bsonType: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
      partySize: { bsonType: 'int', minimum: 1 },
      tablesRequested: { bsonType: 'int', minimum: 1, maximum: 3 },
      status: { enum: ['waiting', 'offered', 'accepted', 'expired', 'cancelled'] },
      offerExpiresAt: { bsonType: 'date' },
      createdAt: { bsonType: 'date' },
      updatedAt: { bsonType: 'date' },
    },
  },
} as const;

async function setup() {
  await client.connect();

  for (const [name, schema] of Object.entries(collections)) {
    const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
    if (!exists) {
      await db.createCollection(name, { validator: { $jsonSchema: schema } });
      console.log(`Created ${name}`);
    }
  }

  await db.collection('users').createIndex({ email: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true });
  await db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await db.collection('restaurants').createIndex({ deletedAt: 1, name: 1 });
  await db.collection('reservations').createIndex({ userId: 1, reservationDate: 1, reservationTime: 1 });
  await db.collection('reservations').createIndex({ restaurantId: 1, reservationDate: 1, reservationTime: 1, status: 1 });
  await db.collection('reservations').createIndex({ reservationDate: 1, status: 1, restaurantId: 1 });
  await db.collection('reservations').createIndex({ status: 1, reservationDate: 1, reservationTime: 1 });
  await db.collection('reservation_slots').createIndex(
    { restaurantId: 1, reservationDate: 1, reservationTime: 1 },
    { unique: true },
  );
  await db.collection('waitlist_entries').createIndex({ restaurantId: 1, reservationDate: 1, reservationTime: 1, status: 1, createdAt: 1, _id: 1 });
  await db.collection('waitlist_entries').createIndex({ status: 1, offerExpiresAt: 1 });
  await db.collection('waitlist_entries').createIndex(
    { userId: 1, restaurantId: 1, reservationDate: 1, reservationTime: 1 },
    { unique: true, partialFilterExpression: { status: { $in: ['waiting', 'offered'] } } },
  );
  console.log('Database indexes ready');
}

setup()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.close());
