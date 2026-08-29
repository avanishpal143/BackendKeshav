import mongoose from 'mongoose';
import { logger } from '../../shared/logger.js';

export async function connectMongo() {
  const uri = process.env.MONGODB_URL;
  if (!uri) {
    logger.warn('MongoDB: MONGODB_URL not set — skipping');
    return;
  }
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 3000,
    });
    logger.info('✅ MongoDB connected');
  } catch (err) {
    logger.warn('MongoDB: connection failed — chat/logs features unavailable', err);
  }
}
