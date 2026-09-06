import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { logger } from '../../shared/logger.js';

const router = Router();

// Razorpay sends raw body — we need it as Buffer to verify signature
// This route MUST use express.raw() BEFORE express.json() parses it
// In app.ts, mount this BEFORE body-parser, or use express.raw here

router.post(
  '/razorpay',
  // Read raw body for signature verification
  (req: any, res: Response, next: any) => {
    let rawBody = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { rawBody += chunk; });
    req.on('end', () => {
      req.rawBody = rawBody;
      try { req.body = JSON.parse(rawBody); } catch (_) {}
      next();
    });
  },
  async (req: any, res: Response) => {
    // Always return 200 quickly to acknowledge Razorpay
    res.status(200).json({ success: true });

    try {
      const signature = req.headers['x-razorpay-signature'] as string;
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

      // Verify signature if webhook secret is configured
      if (webhookSecret && signature) {
        const expected = crypto
          .createHmac('sha256', webhookSecret)
          .update(req.rawBody)
          .digest('hex');

        if (expected !== signature) {
          logger.warn('[Webhook] Invalid Razorpay signature — ignoring');
          return;
        }
      }

      const event = req.body?.event as string;
      const paymentEntity = req.body?.payload?.payment?.entity;

      logger.info(`[Webhook] Razorpay event: ${event}`);

      // Only care about successful one-time payment captures
      if (event === 'payment.captured' && paymentEntity) {
        const paymentId: string = paymentEntity.id;
        const orderId: string = paymentEntity.order_id;
        const amount: number = paymentEntity.amount; // in paise
        const contact: string = paymentEntity.contact?.replace('+91', '') ?? '';

        logger.info(`[Webhook] Payment captured: ${paymentId}, order: ${orderId}, ₹${amount / 100}, mobile: ${contact}`);

        if (!orderId || !contact) return;

        // Check if user already registered (app successfully called /register)
        const existingUser = await queryOne<{ id: string; registration_paid: boolean }>(
          'SELECT id, registration_paid FROM users WHERE mobile=$1',
          [contact]
        );

        if (existingUser?.registration_paid) {
          // Already registered via app — nothing to do
          logger.info(`[Webhook] User ${contact} already registered, skipping`);
          return;
        }

        // User paid but registration didn't complete (app crash, network issue)
        // Mark their registration as paid so they can complete it on next login
        if (existingUser) {
          await query(
            `UPDATE users SET registration_paid=true, subscription_status='active',
             subscription_start=NOW(), subscription_end=NOW() + INTERVAL '30 days',
             last_payment_at=NOW() WHERE id=$1`,
            [existingUser.id]
          );
          logger.info(`[Webhook] Marked registration paid for existing user: ${contact}`);
        } else {
          // Payment done but user not even in DB — log it for admin to handle manually
          logger.warn(`[Webhook] Payment ${paymentId} received but no user found for mobile ${contact}. Manual action needed.`);
        }
      }

      if (event === 'payment.failed' && paymentEntity) {
        const contact = paymentEntity.contact?.replace('+91', '') ?? '';
        logger.warn(`[Webhook] Payment failed for ${contact}: ${paymentEntity.error_description ?? 'unknown'}`);
      }
    } catch (err: any) {
      logger.error(`[Webhook] Processing error: ${err.message}`);
    }
  }
);

export default router;
