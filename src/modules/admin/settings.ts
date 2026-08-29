/**
 * App Settings — global store with database persistence for OTP
 * 
 * OTP System:
 * - Admin can create multiple OTPs
 * - Each OTP stays active until admin deactivates it
 * - Multiple OTPs can be active at the same time
 * - User can login with ANY active OTP
 * - No default OTP — admin must create one
 */
import { query } from '../../infrastructure/database/postgres.js';
import { logger } from '../../shared/logger.js';

export interface AppSettings {
  registrationFee: number;
  monthlyFee: number;
  otpValidityMinutes: number;
  appName: string;
  razorpayKeyId: string;
  updatedAt: string;
  updatedBy: string;
}

export const appSettings: AppSettings = {
  registrationFee: parseInt(process.env.REGISTRATION_FEE || '61'),
  monthlyFee: 0,
  otpValidityMinutes: 1440,
  appName: 'Ekta Koli Jatav Foundation',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? '',
  updatedAt: new Date().toISOString(),
  updatedBy: 'system',
};

/**
 * OTP Record — stored in PostgreSQL `global_otp` table.
 * Multiple can be active simultaneously.
 */
export interface OtpRecord {
  id: number;
  otp: string;
  isActive: boolean;
  createdAt: string;
  createdBy: string;
  usageCount: number;
}

// In-memory cache of ALL active OTPs (loaded from DB)
let activeOtps: OtpRecord[] = [];
let otpCacheLoaded = false;

/**
 * Load all active OTPs from database into memory cache.
 */
async function loadActiveOtps(): Promise<void> {
  try {
    const rows = await query<{ id: number; otp: string; is_active: boolean; created_at: string; created_by: string; usage_count: number }>(
      `SELECT id, otp, is_active, created_at, created_by, usage_count FROM global_otp WHERE is_active = true ORDER BY created_at DESC`
    );
    activeOtps = rows.map(r => ({
      id: r.id,
      otp: r.otp,
      isActive: r.is_active,
      createdAt: r.created_at,
      createdBy: r.created_by,
      usageCount: r.usage_count || 0,
    }));
    otpCacheLoaded = true;
    if (activeOtps.length > 0) {
      logger.info(`[OTP] Loaded ${activeOtps.length} active OTP(s) from DB`);
    } else {
      logger.info(`[OTP] No active OTPs found — admin needs to create one`);
    }
  } catch (err) {
    otpCacheLoaded = true;
    logger.warn(`[OTP] DB load failed — no OTPs available until DB connects`);
  }
}

/**
 * Force reload cache (call after any change)
 */
async function refreshCache(): Promise<void> {
  otpCacheLoaded = false;
  await loadActiveOtps();
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Create a new OTP. Does NOT deactivate existing ones.
 * Admin can have multiple active OTPs.
 */
export async function createOtp(otp: string, adminId: string): Promise<OtpRecord> {
  try {
    await query(
      `INSERT INTO global_otp (otp, is_active, created_by, usage_count) VALUES ($1, true, $2, 0)`,
      [otp, adminId]
    );
    logger.info(`[OTP] Created new OTP: ${otp} by ${adminId}`);
  } catch (err) {
    logger.warn(`[OTP] Failed to save to DB: ${err}`);
  }

  const record: OtpRecord = {
    id: Date.now(),
    otp,
    isActive: true,
    createdAt: new Date().toISOString(),
    createdBy: adminId,
    usageCount: 0,
  };
  activeOtps.push(record);
  return record;
}

/**
 * Deactivate a specific OTP by its value.
 */
export async function deactivateOtp(otp: string): Promise<void> {
  try {
    await query(`UPDATE global_otp SET is_active = false WHERE otp = $1`, [otp]);
    logger.info(`[OTP] Deactivated: ${otp}`);
  } catch (err) {
    logger.warn(`[OTP] Deactivate failed: ${err}`);
  }
  activeOtps = activeOtps.filter(o => o.otp !== otp);
}

/**
 * Activate a specific OTP by its value.
 */
export async function activateOtp(otp: string): Promise<void> {
  try {
    await query(`UPDATE global_otp SET is_active = true WHERE otp = $1`, [otp]);
    logger.info(`[OTP] Activated: ${otp}`);
  } catch (err) {
    logger.warn(`[OTP] Activate failed: ${err}`);
  }
  await refreshCache();
}

/**
 * Deactivate ALL active OTPs at once.
 */
export async function deactivateAllOtps(): Promise<void> {
  try {
    await query(`UPDATE global_otp SET is_active = false WHERE is_active = true`);
    logger.info(`[OTP] All OTPs deactivated`);
  } catch (_) {}
  activeOtps = [];
}

/**
 * Verify if a given OTP matches ANY active OTP.
 * Returns true if valid, false otherwise.
 */
export async function verifyOtp(otp: string): Promise<boolean> {
  // Load from DB if not cached
  if (!otpCacheLoaded) await loadActiveOtps();

  // Check if the provided OTP matches any active OTP
  const matched = activeOtps.find(o => o.otp === otp);
  if (!matched) return false;

  // Update usage count
  matched.usageCount += 1;
  try {
    await query(`UPDATE global_otp SET usage_count = usage_count + 1 WHERE otp = $1 AND is_active = true`, [otp]);
  } catch (_) {}

  return true;
}

/**
 * Get all OTPs (active + inactive) for admin panel display.
 */
export async function getAllOtps(): Promise<OtpRecord[]> {
  try {
    const rows = await query<{ id: number; otp: string; is_active: boolean; created_at: string; created_by: string; usage_count: number }>(
      `SELECT id, otp, is_active, created_at, created_by, usage_count FROM global_otp ORDER BY created_at DESC LIMIT 50`
    );
    return rows.map(r => ({
      id: r.id,
      otp: r.otp,
      isActive: r.is_active,
      createdAt: r.created_at,
      createdBy: r.created_by,
      usageCount: r.usage_count || 0,
    }));
  } catch (_) {
    return activeOtps;
  }
}

/**
 * Get only active OTPs count.
 */
export async function getActiveOtpCount(): Promise<number> {
  if (!otpCacheLoaded) await loadActiveOtps();
  return activeOtps.length;
}

/**
 * Check if OTP system has any active OTP.
 */
export async function hasActiveOtp(): Promise<boolean> {
  if (!otpCacheLoaded) await loadActiveOtps();
  return activeOtps.length > 0;
}

// ─── Legacy compatibility (used by auth.service.ts) ──────────────────────────

// Keep globalOtp for backward compatibility with auth.service.ts
export let globalOtp = {
  otp: '',
  isActive: false,
  createdAt: new Date(),
  createdBy: 'system',
  usageCount: 0,
};

// Legacy function names — redirect to new system
export async function setGlobalOtp(otp: string, adminId: string): Promise<void> {
  await createOtp(otp, adminId);
  globalOtp = { otp, isActive: true, createdAt: new Date(), createdBy: adminId, usageCount: 0 };
}

export async function deactivateGlobalOtp(): Promise<void> {
  await deactivateAllOtps();
  globalOtp.isActive = false;
}

export async function activateGlobalOtp(): Promise<void> {
  if (globalOtp.otp) await activateOtp(globalOtp.otp);
  globalOtp.isActive = true;
}

export async function verifyGlobalOtp(otp: string): Promise<boolean> {
  return verifyOtp(otp);
}

// Payments record
export interface PaymentRecord {
  id: string;
  userId: string;
  mobile: string;
  name: string;
  amount: number;
  type: 'registration';
  status: 'pending' | 'completed' | 'failed';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  createdAt: string;
}

export const payments: PaymentRecord[] = [];
