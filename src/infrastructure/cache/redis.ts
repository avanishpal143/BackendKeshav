import { Redis } from 'ioredis';
import { logger } from '../../shared/logger.js';

let redisClient: Redis | null = null;

export async function connectRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn('Redis: REDIS_URL not set — skipping');
    return;
  }
  try {
    redisClient = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 3000,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null, // disable auto-retry — fail fast
    });
    // Suppress unhandled error events
    redisClient.on('error', () => { /* silenced — Redis is optional in dev */ });
    await redisClient.connect();
    logger.info('✅ Redis connected');
  } catch {
    logger.warn('Redis: not available — OTP cache disabled (dev mode OK)');
    redisClient = null;
  }
}

export function getRedis(): Redis | null {
  return redisClient;
}

// Helper: set with TTL
export async function cacheSet(key: string, value: unknown, ttlSeconds = 300) {
  if (!redisClient) return;
  await redisClient.setex(key, ttlSeconds, JSON.stringify(value));
}

// Helper: get and parse
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redisClient) return null;
  const raw = await redisClient.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheDel(key: string) {
  if (!redisClient) return;
  await redisClient.del(key);
}

// OTP helpers
export async function setOtp(mobile: string, otp: string, ttlSeconds = 300) {
  await cacheSet(`otp:${mobile}`, otp, ttlSeconds);
}

export async function getOtp(mobile: string): Promise<string | null> {
  return cacheGet<string>(`otp:${mobile}`);
}

export async function deleteOtp(mobile: string) {
  await cacheDel(`otp:${mobile}`);
}
