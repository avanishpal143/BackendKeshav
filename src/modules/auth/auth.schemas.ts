import { z } from 'zod';

export const requestOtpSchema = z.object({
  mobile: z.string().regex(/^\d{10}$/, 'Mobile must be 10 digits'),
});

export const verifyOtpSchema = z.object({
  mobile: z.string().regex(/^\d{10}$/, 'Mobile must be 10 digits'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

export const googleLoginSchema = z.object({
  idToken: z.string().min(1, 'Google ID token is required'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const adminLoginSchema = z.object({
  email: z.string().email().optional(),
  mobile: z.string().regex(/^\d{10}$/).optional(),
  password: z.string().min(1),
}).refine(data => data.email || data.mobile, { message: 'Email or mobile required' });
