import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { authRepository, UserRecord } from './auth.repository.js';
import {
  memStore, findUserByMobile, findUserById, createUser,
} from '../../infrastructure/database/memoryStore.js';
import {
  appSettings, globalOtp, setGlobalOtp, deactivateGlobalOtp,
  activateGlobalOtp, verifyGlobalOtp, hasActiveOtp, payments,
} from '../admin/settings.js';
import { AppError } from '../../shared/AppError.js';
import { logger } from '../../shared/logger.js';

const IS_FALLBACK = () => process.env.DB_MEMORY_FALLBACK === 'true';

function getAccessSecret() {
  return process.env.JWT_ACCESS_SECRET || 'dev-access-secret';
}

function makeAccessToken(userId: string, role: string) {
  const secret = getAccessSecret();
  console.log('[AUTH] Signing token with secret:', secret.slice(0, 10) + '...');
  return jwt.sign({ userId, role }, secret, { expiresIn: '7d' });
}

// ─── Razorpay instance (lazy) ─────────────────────────────────────────────────
function getRazorpay(): Razorpay | null {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  
  if (!keyId || !keySecret) return null;
  
  // Reject placeholder values only
  if (keyId.includes('YOUR_KEY') || keySecret.includes('YOUR_KEY')) return null;
  
  // Accept both test and live keys
  if (!keyId.startsWith('rzp_test_') && !keyId.startsWith('rzp_live_')) return null;
  
  try {
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    logger.info(`Razorpay initialized with key: ${keyId.substring(0, 12)}...`);
    return rzp;
  } catch (err) {
    logger.warn('Failed to initialize Razorpay:', err);
    return null;
  }
}

// ─── Razorpay — simple orders only (no subscription/autopay) ──────────────────

export const authService = {
  // ── Admin: manage global OTP ───────────────────────────────────────────────
  generateNewOtp(adminId: string): string {
    // Always generate a random 6-digit OTP (does NOT deactivate existing ones)
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    setGlobalOtp(otp, adminId); // creates new active OTP in DB
    logger.info(`[Admin] New OTP created by ${adminId}: ${otp}`);
    return otp;
  },

  async getGlobalOtpStatus() {
    const { getAllOtps } = await import('../admin/settings.js');
    const allOtps = await getAllOtps();
    const active = allOtps.filter(o => o.isActive);
    return {
      activeCount: active.length,
      otps: allOtps, // all OTPs for history
      currentActive: active, // only active ones
    };
  },

  async toggleOtp(active: boolean, otp?: string) {
    if (otp) {
      // Toggle specific OTP
      const { activateOtp: actOtp, deactivateOtp: deactOtp } = await import('../admin/settings.js');
      if (active) await actOtp(otp);
      else await deactOtp(otp);
      return { isActive: active, otp };
    }
    // Toggle all
    if (active) await activateGlobalOtp();
    else await deactivateGlobalOtp();
    return { isActive: active };
  },

  // ── User: verify OTP ────────────────────────────────────────────────────────
  async verifyOtp(mobile: string, otp: string) {
    // Check if any active OTP exists
    const hasOtp = await hasActiveOtp();
    if (!hasOtp) {
      throw AppError.badRequest('No OTP has been set by admin yet. Please contact admin.', 'NO_OTP');
    }

    // Verify against ALL active OTPs
    const otpValid = await verifyGlobalOtp(otp);
    if (!otpValid) {
      throw AppError.badRequest('Incorrect OTP. Please check with your admin.', 'INVALID_OTP');
    }

    // Check if user exists
    if (IS_FALLBACK()) {
      const existing = findUserByMobile(mobile);
      if (!existing) {
        return { valid: true, isNewUser: true };
      }
      const tokens = buildMemTokens(existing);
      return { valid: true, isNewUser: false, ...tokens, user: buildUserPayload(existing) };
    }

    const existing = await authRepository.findByMobile(mobile).catch(() => null);
    if (!existing) {
      return { valid: true, isNewUser: true };
    }
    const tokens = await buildDbTokens(existing);
    return { valid: true, isNewUser: false, ...tokens, user: buildUserPayload(existing) };
  },

  // ── Create Razorpay order (registration fee only) ────────────────────────────
  async createPaymentOrder(mobile: string, name: string) {
    const amount = appSettings.registrationFee;
    const rz = getRazorpay();

    if (!rz) {
      logger.warn('Razorpay not configured — returning mock order');
      return {
        orderId: `order_dev_${Date.now()}`,
        amount: amount * 100,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID ?? 'rzp_live_TVWCJVVsWhLHtS',
        prefill: { name, contact: `+91${mobile}`, email: 'support@ektakolijatavvikasfoundation.com' },
        description: `Registration Fee ₹${amount}`,
        isDevMode: true,
      };
    }

    try {
      const order: any = await rz.orders.create({
        amount: amount * 100,
        currency: 'INR',
        receipt: `reg_${mobile}_${Date.now()}`,
        notes: { mobile, name, type: 'registration', fee: amount },
      } as any);

      logger.info(`Razorpay order created: ${order.id} for ${mobile} — ₹${amount}`);
      return {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID!,
        prefill: { name, contact: `+91${mobile}`, email: 'support@ektakolijatavvikasfoundation.com' },
        description: `Registration Fee ₹${amount}`,
        isDevMode: false,
      };
    } catch (err: any) {
      const errMsg = err?.error?.description || err?.message || JSON.stringify(err);
      logger.warn(`Razorpay order creation failed: ${errMsg}`);
      return {
        orderId: `order_dev_${Date.now()}`,
        amount: amount * 100,
        currency: 'INR',
        keyId: process.env.RAZORPAY_KEY_ID ?? 'rzp_live_TVWCJVVsWhLHtS',
        prefill: { name, contact: `+91${mobile}`, email: 'support@ektakolijatavvikasfoundation.com' },
        description: `Registration Fee ₹${amount}`,
        isDevMode: true,
      };
    }
  },

  // ── Verify Razorpay payment signature ──────────────────────────────────────
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    // Skip verification in dev mode for mock orders
    if (process.env.NODE_ENV === 'development' && orderId.startsWith('order_dev_')) {
      return true; // Accept all mock payments in development
    }
    
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) return true;  // dev mode: skip verification
    const body = `${orderId}|${paymentId}`;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return expected === signature;
  },

  // ── Register new user ───────────────────────────────────────────────────────
  async registerUser(data: {
    mobile: string;
    name: string;
    district?: string;
    state?: string;
    village?: string;
    bloodGroup?: string;
    emergencyMobile?: string;
    razorpayOrderId?: string;
    razorpayPaymentId?: string;
    razorpaySignature?: string;
    familyMembers?: Array<{
      name: string;
      relation: string;
      age?: number;
      bloodGroup?: string;
      mobile?: string;
    }>;
  }) {
    const { mobile, name, razorpayOrderId, razorpayPaymentId, razorpaySignature } = data;

    // Verify payment signature if provided
    if (razorpayOrderId && razorpayPaymentId && razorpaySignature) {
      const valid = authService.verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
      if (!valid) throw AppError.badRequest('Payment verification failed', 'PAYMENT_INVALID');
    }

    const totalAmount = appSettings.registrationFee + appSettings.monthlyFee;

    let user: UserRecord | ReturnType<typeof createUser>;

    if (IS_FALLBACK()) {
      const existing = findUserByMobile(mobile);
      if (existing) throw AppError.conflict('User with this mobile already exists');
      user = createUser({
        name, mobile, role: 'user',
        district: data.district ?? '',
        state: data.state ?? '',
        blood_group: data.bloodGroup ?? '',
      });

      // Add family members to memory store
      if (data.familyMembers?.length) {
        const fam = { id: uuidv4(), owner_id: (user as ReturnType<typeof createUser>).id, members: data.familyMembers.map(m => ({
          id: uuidv4(), name: m.name, relation: m.relation,
          age: m.age ?? 0, blood_group: m.bloodGroup ?? '', mobile: m.mobile ?? '',
        })) };
        memStore.families.push(fam);
      }
    } else {
      const existing = await authRepository.findByMobile(mobile);
      if (existing) throw AppError.conflict('User already exists');
      user = await authRepository.createUser({ 
        name, mobile, 
        district: data.district, 
        state: data.state, 
        bloodGroup: data.bloodGroup 
      });

      // Add family members to database using raw SQL
      if (data.familyMembers?.length) {
        const { query } = await import('../../infrastructure/database/postgres.js');
        const familyId = uuidv4();
        
        // Insert family record
        await query(
          'INSERT INTO families (id, owner_id, created_at) VALUES ($1, $2, NOW())', 
          [familyId, user.id]
        );
        
        // Insert family members
        for (const member of data.familyMembers) {
          await query(
            'INSERT INTO family_members (id, family_id, name, relation, age, blood_group, mobile, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())',
            [uuidv4(), familyId, member.name, member.relation, member.age ?? null, member.bloodGroup ?? null, member.mobile ?? null]
          );
        }
      }
    }

    const userId = (user as { id: string }).id;

    // Save subscription info if payment was via subscription
    if (razorpayOrderId && razorpayOrderId.startsWith('sub_')) {
      try {
        const { query: dbQ } = await import('../../infrastructure/database/postgres.js');
        await dbQ(
          `UPDATE users SET subscription_id=$1, subscription_status='active', subscription_start=NOW(), subscription_end=NOW() + INTERVAL '30 days', last_payment_at=NOW(), registration_paid=true WHERE id=$2`,
          [razorpayOrderId, userId]
        );
        logger.info(`[Subscription] Saved for user ${userId}: ${razorpayOrderId}`);
      } catch (subErr) {
        logger.warn(`[Subscription] Failed to save: ${subErr}`);
      }
    } else if (razorpayPaymentId) {
      // One-time payment (no subscription) — mark registration paid
      try {
        const { query: dbQ } = await import('../../infrastructure/database/postgres.js');
        await dbQ(
          `UPDATE users SET registration_paid=true, subscription_status='active', subscription_start=NOW(), subscription_end=NOW() + INTERVAL '30 days', last_payment_at=NOW() WHERE id=$1`,
          [userId]
        );
      } catch (_) {}
    }

    // Record payment
    payments.push({
      id: uuidv4(), userId, mobile, name, amount: totalAmount,
      type: 'registration',
      status: razorpayPaymentId ? 'completed' : 'pending',
      razorpayOrderId, razorpayPaymentId,
      createdAt: new Date().toISOString(),
    });

    logger.info(`New user registered: ${mobile} (${name}) — payment ₹${totalAmount} ${razorpayPaymentId ? '✓ PAID' : '(pending)'}`);

    if (IS_FALLBACK()) {
      const memUser = user as ReturnType<typeof createUser>;
      const tokens = buildMemTokens(memUser);
      return { ...tokens, user: buildUserPayload(memUser), totalPaid: totalAmount };
    }
    const dbUser = user as UserRecord;
    const tokens = await buildDbTokens(dbUser);
    return { ...tokens, user: buildUserPayload(dbUser), totalPaid: totalAmount };
  },

  // ── Admin/Staff login (email or mobile + password) ───────────────────────
  async adminLogin(identifier: string, password: string) {
    // Find user by email or mobile
    let dbUser = null;
    if (!IS_FALLBACK()) {
      try {
        const { queryOne: dbQuery } = await import('../../infrastructure/database/postgres.js');
        // Try email first
        if (identifier.includes('@')) {
          dbUser = await authRepository.findByEmail?.(identifier) || null;
          if (!dbUser) {
            const row = await dbQuery<any>('SELECT * FROM users WHERE email=$1', [identifier]);
            if (row) dbUser = { id: row.id, name: row.name, mobile: row.mobile, role: row.role, district: row.district, blood_group: row.blood_group, member_id: row.member_id };
          }
        }
        // Try mobile
        if (!dbUser) {
          dbUser = await authRepository.findByMobile(identifier).catch(() => null);
        }
      } catch (err) {
        logger.warn(`Admin login DB lookup failed: ${err}`);
      }
    }

    if (!dbUser) {
      // Dev mode fallback
      if (process.env.ADMIN_AUTH_DISABLED === 'true') {
        let user = findUserByMobile(identifier);
        if (!user) user = createUser({ name: 'Dev Admin', mobile: identifier, role: 'super_admin' });
        return buildMemTokens(user);
      }
      throw AppError.unauthorized('Invalid credentials');
    }

    // Check role
    const adminRoles = ['staff', 'volunteer', 'district_admin', 'state_admin', 'super_admin'];
    if (!adminRoles.includes(dbUser.role)) throw AppError.forbidden('Not an admin/staff account');

    // Verify password (skip if ADMIN_AUTH_DISABLED)
    if (process.env.ADMIN_AUTH_DISABLED !== 'true') {
      const { query: dbQ } = await import('../../infrastructure/database/postgres.js');
      const userRow = await dbQ<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id=$1', [dbUser.id]);
      const passwordHash = userRow[0]?.password_hash;
      if (passwordHash) {
        const valid = await bcrypt.compare(password, passwordHash);
        if (!valid) throw AppError.unauthorized('Invalid credentials');
      } else if (password !== 'dev') {
        throw AppError.unauthorized('No password set. Contact super admin.');
      }
    }

    // Load permissions
    const permissions = await this.getStaffPermissions(dbUser.id);
    const tokens = await buildDbTokens(dbUser as UserRecord);
    return { ...tokens, permissions };
  },

  // Get staff module permissions
  async getStaffPermissions(userId: string): Promise<Array<{ module: string; canRead: boolean; canWrite: boolean }>> {
    if (IS_FALLBACK()) return [];
    try {
      const { query: dbQuery } = await import('../../infrastructure/database/postgres.js');
      const rows = await dbQuery<{ module: string; can_read: boolean; can_write: boolean }>(
        'SELECT module, can_read, can_write FROM staff_permissions WHERE user_id=$1',
        [userId]
      );
      return rows.map(r => ({ module: r.module, canRead: r.can_read, canWrite: r.can_write }));
    } catch (_) {
      return [];
    }
  },

  async refreshToken(token: string) {
    if (IS_FALLBACK()) {
      const record = memStore.refreshTokens.get(token);
      if (!record || new Date(record.expiresAt) < new Date()) {
        memStore.refreshTokens.delete(token);
        throw AppError.unauthorized('Refresh token expired');
      }
      const user = findUserById(record.userId);
      if (!user) throw AppError.unauthorized();
      memStore.refreshTokens.delete(token);
      return buildMemTokens(user);
    }
    const record = await authRepository.findRefreshToken(token);
    if (!record || new Date(record.expires_at) < new Date()) {
      await authRepository.deleteRefreshToken(token).catch(() => {});
      throw AppError.unauthorized('Refresh token expired');
    }
    const user = await authRepository.findById(record.user_id);
    if (!user) throw AppError.unauthorized();
    await authRepository.deleteRefreshToken(token);
    return buildDbTokens(user);
  },

  async logout(refreshToken: string) {
    memStore.refreshTokens.delete(refreshToken);
    await authRepository.deleteRefreshToken(refreshToken).catch(() => {});
    return { message: 'Logged out' };
  },

  getSettings() {
    return {
      registrationFee: appSettings.registrationFee,
      monthlyFee: appSettings.monthlyFee,
      totalFirstPayment: appSettings.registrationFee + appSettings.monthlyFee,
      otpValidityMinutes: appSettings.otpValidityMinutes,
      razorpayKeyId: appSettings.razorpayKeyId || process.env.RAZORPAY_KEY_ID || '',
    };
  },
};

function buildUserPayload(user: { id: string; name: string; mobile: string; role: string; district?: string; blood_group?: string; member_id?: string; avatar_url?: string | null }) {
  return { id: user.id, name: user.name, mobile: user.mobile, role: user.role, district: user.district ?? null, bloodGroup: user.blood_group ?? null, memberId: user.member_id ?? null, avatarUrl: user.avatar_url ?? null };
}

function buildMemTokens(user: { id: string; name: string; mobile: string; role: string; district?: string; blood_group?: string; member_id?: string; avatar_url?: string | null }) {
  const accessToken = makeAccessToken(user.id, user.role);
  const refreshToken = uuidv4();
  memStore.refreshTokens.set(refreshToken, { userId: user.id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
  return { accessToken, refreshToken, expiresIn: 900 };
}

async function buildDbTokens(user: UserRecord) {
  const accessToken = makeAccessToken(user.id, user.role);
  const refreshToken = uuidv4();
  await authRepository.saveRefreshToken(user.id, refreshToken, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).catch(() => {});
  return { accessToken, refreshToken, expiresIn: 900 };
}
