import { Router } from 'express';
import crypto from 'crypto';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { logger } from '../../shared/logger.js';
import { appSettings } from '../admin/settings.js';

const router = Router();

// ══════════════════════════════════════════════════════════════════════════════
// GET /subscription/my — User checks their subscription status
// ══════════════════════════════════════════════════════════════════════════════
router.get('/my', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const row = await queryOne<{
      subscription_id: string | null;
      subscription_status: string;
      subscription_start: string | null;
      subscription_end: string | null;
      last_payment_at: string | null;
      registration_paid: boolean;
    }>('SELECT subscription_id, subscription_status, subscription_start, subscription_end, last_payment_at, registration_paid FROM users WHERE id=$1', [userId]);

    if (!row) return res.status(404).json({ success: false, message: 'User not found' });

    const isExpired = row.subscription_end ? new Date(row.subscription_end) < new Date() : true;
    const daysLeft = row.subscription_end
      ? Math.max(0, Math.ceil((new Date(row.subscription_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;

    success(res, {
      subscriptionId: row.subscription_id,
      status: isExpired ? 'expired' : row.subscription_status,
      startDate: row.subscription_start,
      endDate: row.subscription_end,
      lastPayment: row.last_payment_at,
      registrationPaid: row.registration_paid,
      isExpired,
      daysLeft,
      monthlyFee: appSettings.monthlyFee,
      registrationFee: appSettings.registrationFee,
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /subscription/renew — Create Razorpay order for monthly renewal (₹151)
// ══════════════════════════════════════════════════════════════════════════════
router.post('/renew', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const user = await queryOne<{ name: string; mobile: string }>('SELECT name, mobile FROM users WHERE id=$1', [userId]);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const Razorpay = (await import('razorpay')).default;
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return res.status(500).json({ success: false, message: 'Payment not configured' });
    }

    const rz = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const amount = appSettings.monthlyFee; // ₹151

    const order: any = await (rz as any).orders.create({
      amount: amount * 100,
      currency: 'INR',
      receipt: `renew_${user.mobile}_${Date.now()}`,
      notes: { userId, mobile: user.mobile, type: 'monthly_renewal' },
    });

    logger.info(`[Renewal] Order created: ${order.id} for ${user.mobile} — ₹${amount}`);
    success(res, {
      orderId: order.id,
      amount: order.amount,
      currency: 'INR',
      keyId,
      prefill: { name: user.name, contact: user.mobile },
      description: `Monthly Membership Renewal — ₹${amount}`,
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /subscription/confirm-renewal — After successful payment, extend 30 days
// ══════════════════════════════════════════════════════════════════════════════
router.post('/confirm-renewal', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    // Verify payment signature
    const secret = process.env.RAZORPAY_KEY_SECRET || '';
    const body = `${razorpayOrderId}|${razorpayPaymentId}`;
    const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');

    if (razorpaySignature && expectedSig !== razorpaySignature) {
      return res.status(400).json({ success: false, message: 'Payment verification failed' });
    }

    // Extend subscription by 30 days from today (or from current end date if still active)
    const currentUser = await queryOne<{ subscription_end: string | null }>(
      'SELECT subscription_end FROM users WHERE id=$1', [userId]
    );

    let baseDate = new Date();
    if (currentUser?.subscription_end) {
      const endDate = new Date(currentUser.subscription_end);
      if (endDate > baseDate) baseDate = endDate; // extend from current end, not from today
    }

    const newEnd = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);

    await query(
      `UPDATE users SET subscription_status='active', subscription_end=$1, last_payment_at=NOW() WHERE id=$2`,
      [newEnd.toISOString(), userId]
    );

    logger.info(`[Renewal] User ${userId} extended to ${newEnd.toISOString()}`);
    success(res, {
      message: 'Membership renewed successfully!',
      newEndDate: newEnd.toISOString(),
      daysAdded: 30,
    });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /subscription/admin — Admin: all users' subscription status
// ══════════════════════════════════════════════════════════════════════════════
router.get('/admin', authenticate, requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;
    const status = (req.query.status as string) || '';

    let where = 'WHERE registration_paid = true';
    const params: unknown[] = [];
    let p = 1;

    if (status === 'active') {
      where += ` AND subscription_end >= NOW()`;
    } else if (status === 'expired') {
      where += ` AND subscription_end < NOW()`;
    }

    const [rows, countRow] = await Promise.all([
      query(
        `SELECT id, name, mobile, subscription_id, subscription_status, subscription_start, subscription_end, last_payment_at, registration_paid
         FROM users ${where} ORDER BY subscription_end ASC NULLS FIRST LIMIT $${p} OFFSET $${p + 1}`,
        [...params, limit, offset]
      ),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM users ${where}`, params),
    ]);

    // Add isExpired and daysLeft to each row
    const enriched = (rows as any[]).map(r => ({
      ...r,
      isExpired: r.subscription_end ? new Date(r.subscription_end) < new Date() : true,
      daysLeft: r.subscription_end ? Math.max(0, Math.ceil((new Date(r.subscription_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24))) : 0,
    }));

    paginated(res, enriched, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /subscription/webhook — Razorpay webhook for subscription events
// ══════════════════════════════════════════════════════════════════════════════
router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    // Verify signature
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET || '';
    const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (signature && signature !== expectedSig) {
      logger.warn('[Webhook] Invalid signature');
      return res.status(400).json({ success: false });
    }

    const event = typeof req.body === 'string' ? JSON.parse(body) : req.body;
    const eventType = event.event;
    const payload = event.payload;

    logger.info(`[Webhook] Received: ${eventType}`);

    switch (eventType) {
      case 'subscription.charged': {
        // Monthly payment successful — extend subscription
        const subId = payload.subscription?.entity?.id;
        if (subId) {
          await query(
            `UPDATE users SET subscription_status='active', subscription_end=NOW() + INTERVAL '30 days', last_payment_at=NOW() WHERE subscription_id=$1`,
            [subId]
          );
          logger.info(`[Webhook] Subscription charged: ${subId} — extended 30 days`);
        }
        break;
      }
      case 'subscription.activated': {
        const subId = payload.subscription?.entity?.id;
        if (subId) {
          await query(`UPDATE users SET subscription_status='active' WHERE subscription_id=$1`, [subId]);
          logger.info(`[Webhook] Subscription activated: ${subId}`);
        }
        break;
      }
      case 'subscription.halted':
      case 'subscription.cancelled': {
        const subId = payload.subscription?.entity?.id;
        if (subId) {
          await query(`UPDATE users SET subscription_status='expired' WHERE subscription_id=$1`, [subId]);
          logger.info(`[Webhook] Subscription ${eventType}: ${subId}`);
        }
        break;
      }
      case 'subscription.pending': {
        const subId = payload.subscription?.entity?.id;
        if (subId) {
          await query(`UPDATE users SET subscription_status='pending' WHERE subscription_id=$1`, [subId]);
          logger.info(`[Webhook] Subscription pending: ${subId}`);
        }
        break;
      }
      case 'payment.captured': {
        logger.info(`[Webhook] Payment captured: ${payload.payment?.entity?.id}`);
        break;
      }
    }

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error('[Webhook] Error:', err);
    res.status(200).json({ success: true }); // Always 200 to prevent retries
  }
});

export default router;
