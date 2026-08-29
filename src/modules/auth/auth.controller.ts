import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service.js';
import { adminLoginSchema, refreshTokenSchema } from './auth.schemas.js';
import { success } from '../../shared/response.js';
import { z } from 'zod';
import { findUserByMobile } from '../../infrastructure/database/memoryStore.js';

const verifyOtpSchema = z.object({
  mobile: z.string().regex(/^\d{10}$/),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

const registerSchema = z.object({
  mobile: z.string().regex(/^\d{10}$/),
  name: z.string().min(2),
  district: z.string().optional(),
  state: z.string().optional(),
  village: z.string().optional(),
  bloodGroup: z.string().optional(),
  emergencyMobile: z.string().optional(),
  razorpayOrderId: z.string().optional(),
  razorpayPaymentId: z.string().optional(),
  razorpaySignature: z.string().optional(),
  transactionId: z.string().optional(),  // legacy support
  familyMembers: z.array(z.object({
    name: z.string().min(1),
    relation: z.string().min(1),
    age: z.number().optional(),
    bloodGroup: z.string().optional(),
    mobile: z.string().optional(),
  })).optional(),
});

export const authController = {
  // GET /auth/settings
  async getSettings(_req: Request, res: Response, next: NextFunction) {
    try { success(res, authService.getSettings()); } catch (err) { next(err); }
  },

  // POST /auth/verify-otp
  async verifyOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { mobile, otp } = verifyOtpSchema.parse(req.body);
      const result = await authService.verifyOtp(mobile, otp);
      success(res, result);
    } catch (err) { next(err); }
  },

  // POST /auth/create-payment-order
  async createPaymentOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const { mobile, name } = z.object({ mobile: z.string(), name: z.string() }).parse(req.body);
      const order = await authService.createPaymentOrder(mobile, name);
      success(res, order);
    } catch (err) { next(err); }
  },

  // POST /auth/register
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const data = registerSchema.parse(req.body);
      const result = await authService.registerUser({
        mobile: data.mobile as string,
        name: data.name as string,
        district: data.district,
        state: data.state,
        village: data.village,
        bloodGroup: data.bloodGroup,
        emergencyMobile: data.emergencyMobile,
        razorpayOrderId: data.razorpayOrderId,
        razorpayPaymentId: data.razorpayPaymentId,
        razorpaySignature: data.razorpaySignature,
        familyMembers: data.familyMembers as Array<{ name: string; relation: string; age?: number; bloodGroup?: string; mobile?: string }> | undefined,
      });
      success(res, result, 201);
    } catch (err) { next(err); }
  },

  // POST /auth/admin-login
  async adminLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, mobile, password } = adminLoginSchema.parse(req.body);
      
      // Find user by email or mobile
      const identifier = email || mobile || '';
      const result = await authService.adminLogin(identifier, password);

      // Get user from DB for accurate role
      let user: any = null;
      try {
        const { queryOne } = await import('../../infrastructure/database/postgres.js');
        if (email) {
          user = await queryOne('SELECT id, name, mobile, role, district, blood_group, member_id, avatar_url, is_active FROM users WHERE email=$1', [email]);
        }
        if (!user && mobile) {
          user = await queryOne('SELECT id, name, mobile, role, district, blood_group, member_id, avatar_url, is_active FROM users WHERE mobile=$1', [mobile]);
        }
      } catch (_) {}

      if (!user) {
        user = findUserByMobile(mobile || '') ?? {
          id: `dev-admin`, name: 'Admin', mobile: mobile || '',
          role: 'super_admin', district: '', blood_group: '', member_id: 'ADMIN', avatar_url: null,
        };
      }

      // Check if account is active
      if (user.is_active === false) {
        return res.status(403).json({ success: false, error: 'Account is disabled. Contact admin.' });
      }

      success(res, {
        ...result,
        user: { id: user.id, name: user.name, mobile: user.mobile, role: user.role,
          district: user.district, bloodGroup: user.blood_group, memberId: user.member_id, avatarUrl: user.avatar_url },
        permissions: (result as any).permissions ?? [],
      });
    } catch (err) { next(err); }
  },

  // POST /auth/refresh
  async refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = refreshTokenSchema.parse(req.body);
      success(res, await authService.refreshToken(refreshToken));
    } catch (err) { next(err); }
  },

  // POST /auth/logout
  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = refreshTokenSchema.parse(req.body);
      success(res, await authService.logout(refreshToken));
    } catch (err) { next(err); }
  },

  // GET /auth/me
  async me(req: Request, res: Response, next: NextFunction) {
    try { success(res, { userId: req.user!.userId, role: req.user!.role }); } catch (err) { next(err); }
  },
};
