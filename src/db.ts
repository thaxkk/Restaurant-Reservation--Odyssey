import { MongoClient } from 'mongodb';
import { config } from './config.js';

export const client = new MongoClient(config.MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
});

export const db = client.db(config.MONGODB_DB_NAME);
