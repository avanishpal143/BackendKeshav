import { Router } from 'express';
import { authController } from './auth.controller.js';
import { authenticate } from '../../shared/middleware/authenticate.js';
import { authRateLimiter } from '../../shared/middleware/rateLimiter.js';

const router = Router();

router.get('/settings', authController.getSettings);
router.post('/verify-otp', authRateLimiter, authController.verifyOtp);
router.post('/create-payment-order', authRateLimiter, authController.createPaymentOrder);
router.post('/register', authRateLimiter, authController.register);
router.post('/admin-login', authRateLimiter, authController.adminLogin);
router.post('/refresh', authController.refreshToken);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);

export default router;
