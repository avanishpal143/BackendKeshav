import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success } from '../../shared/response.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { globalOtp, appSettings, payments } from './settings.js';

const router = Router();

// Public basic health
router.get('/', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Detailed system health — admin only
router.get('/detailed', authenticate, requireRole('super_admin', 'state_admin'), async (_req, res, next) => {
  try {
    const startTime = Date.now();

    // Check each service
    const checks = await Promise.allSettled([
      checkPostgres(),
      checkMongo(),
      checkRedis(),
      checkRazorpay(),
      checkGoogleMaps(),
    ]);

    const [postgres, mongo, redis, razorpay, googleMaps] = checks.map(r =>
      r.status === 'fulfilled' ? r.value : { status: 'error', message: String((r as PromiseRejectedResult).reason) }
    );

    // API endpoints check
    const apis = [
      { name: 'Auth - Settings', path: '/api/v1/auth/settings', method: 'GET' },
      { name: 'Auth - Verify OTP', path: '/api/v1/auth/verify-otp', method: 'POST' },
      { name: 'Auth - Register', path: '/api/v1/auth/register', method: 'POST' },
      { name: 'Users', path: '/api/v1/users', method: 'GET', requiresAuth: true },
      { name: 'Family', path: '/api/v1/family', method: 'GET', requiresAuth: true },
      { name: 'Blood Donors', path: '/api/v1/blood-donors', method: 'GET', requiresAuth: true },
      { name: 'Blood Requests', path: '/api/v1/blood-requests', method: 'GET', requiresAuth: true },
      { name: 'Police', path: '/api/v1/police', method: 'GET', requiresAuth: true },
      { name: 'Hospitals', path: '/api/v1/hospitals', method: 'GET', requiresAuth: true },
      { name: 'SOS', path: '/api/v1/sos', method: 'GET', requiresAuth: true },
      { name: 'Complaints', path: '/api/v1/complaints', method: 'GET', requiresAuth: true },
      { name: 'Events', path: '/api/v1/events', method: 'GET', requiresAuth: true },
      { name: 'News', path: '/api/v1/news', method: 'GET', requiresAuth: true },
      { name: 'Staff', path: '/api/v1/staff', method: 'GET', requiresAuth: true },
      { name: 'Notifications', path: '/api/v1/notifications', method: 'GET', requiresAuth: true },
      { name: 'Chat', path: '/api/v1/chat/support/room', method: 'GET', requiresAuth: true },
      { name: 'Geo - Nearby', path: '/api/v1/geo/nearby', method: 'GET', requiresAuth: true },
      { name: 'Admin - Dashboard', path: '/api/v1/admin/dashboard', method: 'GET', requiresAuth: true },
      { name: 'Admin - OTP Status', path: '/api/v1/admin/otp-status', method: 'GET', requiresAuth: true },
      { name: 'Admin - Settings', path: '/api/v1/admin/settings', method: 'GET', requiresAuth: true },
      { name: 'Admin - Payments', path: '/api/v1/admin/payments', method: 'GET', requiresAuth: true },
    ];

    // Memory stats
    const memUsage = process.memoryUsage();
    const uptimeSeconds = Math.floor(process.uptime());

    // Data stats
    const dataStats = {
      users: memStore.users.length,
      families: memStore.families.length,
      bloodDonors: memStore.bloodDonors.length,
      sosAlerts: memStore.sosAlerts.length,
      complaints: memStore.complaints.length,
      bloodRequests: memStore.bloodRequests.length,
      events: memStore.events.length,
      news: memStore.news.length,
      staff: memStore.staff.length,
      notifications: memStore.notifications.length,
      payments: payments.length,
    };

    // Known issues / bugs
    const knownIssues = [];
    if (process.env.DB_MEMORY_FALLBACK === 'true') {
      knownIssues.push({
        severity: 'warning',
        module: 'Database',
        issue: 'Running in memory fallback mode — all data will be lost on server restart',
        fix: 'Set DB_MEMORY_FALLBACK=false and configure POSTGRES_URL with a real PostgreSQL instance (e.g. Neon.tech free tier)',
      });
    }
    if (!process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY.includes('Demo')) {
      knownIssues.push({
        severity: 'info',
        module: 'Google Maps',
        issue: 'No Google Maps API key configured — nearby police/hospital using demo data',
        fix: 'Get a free Google Maps API key from console.cloud.google.com and set GOOGLE_MAPS_API_KEY in .env',
      });
    }
    if (!globalOtp.otp || !globalOtp.isActive) {
      knownIssues.push({
        severity: 'warning',
        module: 'OTP',
        issue: 'No active OTP — users cannot login or register',
        fix: 'Go to OTP Management and generate a new OTP, then share it with users',
      });
    }
    if (String(redis).includes('error') || String(redis).includes('disabled')) {
      knownIssues.push({
        severity: 'info',
        module: 'Redis',
        issue: 'Redis not connected — OTP cache disabled, rate limiting in memory only',
        fix: 'Install Redis locally or use Redis Cloud free tier, set REDIS_URL in .env',
      });
    }

    success(res, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      responseTimeMs: Date.now() - startTime,
      environment: process.env.NODE_ENV,
      uptime: {
        seconds: uptimeSeconds,
        human: formatUptime(uptimeSeconds),
      },
      services: {
        postgres,
        mongodb: mongo,
        redis,
        razorpay,
        googleMaps,
        firebase: {
          status: 'not_configured',
          message: 'Firebase not configured — push notifications disabled. Add google-services.json to enable.',
          note: 'Required for real push notifications',
        },
        whatsapp: {
          status: 'not_configured',
          message: 'WhatsApp Business API not configured — SOS alerts sent via app only',
        },
      },
      database: {
        mode: process.env.DB_MEMORY_FALLBACK === 'true' ? 'memory_fallback' : 'postgresql',
        note: process.env.DB_MEMORY_FALLBACK === 'true' ? '⚠ Data is not persisted between server restarts' : '✓ Data persisted to PostgreSQL',
        stats: dataStats,
      },
      otp: {
        isSet: !!globalOtp.otp,
        isActive: globalOtp.isActive,
        usageCount: globalOtp.usageCount,
        warning: !globalOtp.isActive ? 'OTP inactive — users cannot login' : null,
      },
      pricing: {
        registrationFee: appSettings.registrationFee,
        monthlyFee: appSettings.monthlyFee,
        totalFirstPayment: appSettings.registrationFee + appSettings.monthlyFee,
      },
      memory: {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memUsage.rss / 1024 / 1024),
      },
      apis: { total: apis.length, list: apis },
      knownIssues,
      recommendations: getRecommendations(),
    });
  } catch (err) { next(err); }
});

async function checkPostgres(): Promise<{ status: string; message: string; note?: string }> {
  if (process.env.DB_MEMORY_FALLBACK === 'true') {
    return { status: 'disabled', message: 'PostgreSQL disabled — using in-memory fallback', note: 'Use Neon.tech free PostgreSQL for persistence' };
  }
  try {
    const { query } = await import('../../infrastructure/database/postgres.js');
    await query('SELECT 1');
    return { status: 'connected', message: 'PostgreSQL connected and healthy' };
  } catch (e) {
    return { status: 'error', message: `PostgreSQL connection failed: ${e}` };
  }
}

async function checkMongo(): Promise<{ status: string; message: string }> {
  try {
    const mongoose = await import('mongoose');
    const state = mongoose.default.connection.readyState;
    if (state === 1) return { status: 'connected', message: 'MongoDB Atlas connected — chat/logs working' };
    if (state === 2) return { status: 'connecting', message: 'MongoDB connecting...' };
    return { status: 'disconnected', message: 'MongoDB disconnected' };
  } catch {
    return { status: 'error', message: 'MongoDB check failed' };
  }
}

async function checkRedis(): Promise<{ status: string; message: string }> {
  try {
    const { getRedis } = await import('../../infrastructure/cache/redis.js');
    const client = getRedis();
    if (!client) return { status: 'disabled', message: 'Redis not connected — OTP cache disabled (dev mode OK)' };
    await client.ping();
    return { status: 'connected', message: 'Redis connected — OTP caching and rate limiting active' };
  } catch {
    return { status: 'error', message: 'Redis not available' };
  }
}

async function checkRazorpay(): Promise<{ status: string; message: string }> {
  const keyId = process.env.RAZORPAY_KEY_ID ?? '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET ?? '';
  if (!keyId || keyId.includes('YOUR_KEY')) {
    return { status: 'not_configured', message: 'Razorpay keys not set — payments will fail' };
  }
  const isLive = keyId.startsWith('rzp_live_');
  return {
    status: 'configured',
    message: `Razorpay ${isLive ? 'LIVE' : 'TEST'} keys configured — payments ${isLive ? 'REAL' : 'test mode'}`,
  };
}

async function checkGoogleMaps(): Promise<{ status: string; message: string }> {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
  if (!key || key.includes('Demo') || key.includes('YOUR')) {
    return { status: 'not_configured', message: 'No Google Maps API key — using demo location data' };
  }
  return { status: 'configured', message: 'Google Maps API key set — real nearby places search enabled' };
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function getRecommendations(): string[] {
  const rec: string[] = [];
  if (process.env.DB_MEMORY_FALLBACK === 'true') {
    rec.push('🔴 CRITICAL: Connect a real PostgreSQL database (Neon.tech free tier recommended) to persist data');
  }
  if (process.env.JWT_ACCESS_SECRET === 'dev-access-secret') {
    rec.push('🔴 CRITICAL: Change JWT_ACCESS_SECRET to a strong random string before production');
  }
  if (!process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY.includes('Demo')) {
    rec.push('🟡 IMPORTANT: Add Google Maps API key for real nearby police/hospital search');
  }
  rec.push('🟡 IMPORTANT: Configure Firebase (google-services.json) for real push notifications');
  rec.push('🟢 OPTIONAL: Set up Redis Cloud for better OTP caching and rate limiting');
  rec.push('🟢 OPTIONAL: Configure Cloudflare R2 for image uploads');
  return rec;
}

export default router;
