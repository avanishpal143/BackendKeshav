import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { emitToUser, broadcast } from '../../infrastructure/realtime/socket.js';

const router = Router();
router.use(authenticate);

// GET / — own notifications
router.get('/', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = 30;

    if (isFallback()) {
      const items = memStore.notifications
        .filter(n => n.user_id === req.user!.userId)
        .slice().reverse();
      const total = items.length;
      return paginated(res, items.slice((page - 1) * limit, page * limit), total, page, limit);
    }

    const offset = (page - 1) * limit;
    const [rows, countRow] = await Promise.all([
      query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [req.user!.userId, limit, offset]),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM notifications WHERE user_id=$1', [req.user!.userId]),
    ]);
    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

// PATCH /:id/read
router.patch('/:id/read', async (req, res, next) => {
  try {
    if (isFallback()) {
      const n = memStore.notifications.find(n => n.id === req.params.id && n.user_id === req.user!.userId);
      if (n) n.is_read = true;
      return success(res, { updated: true });
    }
    await query('UPDATE notifications SET is_read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user!.userId]);
    success(res, { updated: true });
  } catch (err) { next(err); }
});

// PATCH /mark-all-read
router.patch('/mark-all-read', async (req, res, next) => {
  try {
    if (isFallback()) {
      memStore.notifications.filter(n => n.user_id === req.user!.userId).forEach(n => { n.is_read = true; });
      return success(res, { updated: true });
    }
    await query('UPDATE notifications SET is_read=true WHERE user_id=$1', [req.user!.userId]);
    success(res, { updated: true });
  } catch (err) { next(err); }
});

// POST /send — admin broadcast
router.post('/send', requireRole('super_admin', 'state_admin', 'district_admin'), async (req, res, next) => {
  try {
    const { title, body, type, targetUserId, district } = req.body;
    const now = new Date().toISOString();

    // Import FCM functions
    const { sendPushToDevice, sendPushToDevices, sendPushToTopic } = await import('../../infrastructure/push/firebase.js');

    if (isFallback()) {
      if (targetUserId) {
        memStore.notifications.push({ id: uuidv4(), user_id: targetUserId, title, body, type: type ?? 'system', is_read: false, created_at: now });
        try { emitToUser(targetUserId, 'notification', { title, body }); } catch {}
        const user = memStore.users.find(u => u.id === targetUserId);
        if (user?.fcm_token) await sendPushToDevice(user.fcm_token, title, body);
      } else {
        // Broadcast to all users
        memStore.users.forEach(u => {
          memStore.notifications.push({ id: uuidv4(), user_id: u.id, title, body, type: type ?? 'system', is_read: false, created_at: now });
        });
        try { broadcast('notification', { title, body }); } catch {}
        // Send FCM to topic 'all'
        await sendPushToTopic('all', title, body, { type: type ?? 'system' });
      }
      return success(res, { sent: true });
    }

    if (targetUserId) {
      await query('INSERT INTO notifications (id,user_id,title,body,type) VALUES ($1,$2,$3,$4,$5)', [uuidv4(), targetUserId, title, body, type ?? 'system']);
      try { emitToUser(targetUserId, 'notification', { title, body }); } catch {}
      // Send FCM push to specific user
      const user = await queryOne<{ fcm_token: string | null }>('SELECT fcm_token FROM users WHERE id=$1', [targetUserId]);
      if (user?.fcm_token) await sendPushToDevice(user.fcm_token, title, body, { type: type ?? 'system' });
    } else {
      // Broadcast: save for all users + send FCM
      const allUsers = await query<{ id: string; fcm_token: string | null }>('SELECT id, fcm_token FROM users WHERE is_active=true');
      const batchInsert = allUsers.map(u => query(
        'INSERT INTO notifications (id,user_id,title,body,type) VALUES ($1,$2,$3,$4,$5)',
        [uuidv4(), u.id, title, body, type ?? 'system']
      ));
      await Promise.all(batchInsert);
      try { broadcast('notification', { title, body }); } catch {}
      // Send FCM push via topic or direct
      if (district) {
        await sendPushToTopic(`district-${district}`, title, body, { type: type ?? 'system' });
      } else {
        // Try topic 'all' first (most efficient), fallback to direct device tokens
        const topicSent = await sendPushToTopic('all', title, body, { type: type ?? 'system' });
        if (!topicSent) {
          const tokens = allUsers.map(u => u.fcm_token).filter(Boolean) as string[];
          if (tokens.length > 0) await sendPushToDevices(tokens, title, body, { type: type ?? 'system' });
        }
      }
    }
    success(res, { sent: true });
  } catch (err) { next(err); }
});

export default router;
