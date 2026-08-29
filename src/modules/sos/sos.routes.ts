import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { sosRateLimiter } from '../../shared/middleware/rateLimiter.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore, findUserById } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { emitToAdmins, emitToDistrict } from '../../infrastructure/realtime/socket.js';

import { geoService } from '../geo/geo.service.js';

const router = Router();
router.use(authenticate);

// POST / — trigger SOS
router.post('/', sosRateLimiter, async (req, res, next) => {
  try {
    const { latitude, longitude, address } = req.body;
    const now = new Date().toISOString();

    if (isFallback()) {
      const user = findUserById(req.user!.userId);
      const sos = {
        id: uuidv4(),
        user_id: req.user!.userId,
        name: user?.name ?? 'User',
        mobile: user?.mobile ?? '',
        district: user?.district ?? '',
        latitude: latitude ?? 0,
        longitude: longitude ?? 0,
        address: address ?? 'Location unavailable',
        status: 'pending',
        assigned_to: null,
        notes: null,
        created_at: now,
        updated_at: now,
      };
      memStore.sosAlerts.push(sos);

      // Auto-reverse-geocode in background
      geoService.reverseGeocode(latitude ?? 0, longitude ?? 0)
        .then(addr => { sos.address = addr; })
        .catch(() => {});

      const payload = {
        ...sos,
        whatsappPayload: {
          message: `🚨 SOS ALERT!\nUser: ${user?.name}\nMobile: ${user?.mobile}\nLocation: ${address}\nLat: ${latitude}, Lng: ${longitude}\nTime: ${new Date().toLocaleString('en-IN')}`,
        },
      };
      try { emitToAdmins('sos-alert', payload); } catch {}
      try { if (user?.district) emitToDistrict(user.district, 'sos-alert', payload); } catch {}
      return success(res, payload, 201);
    }

    const rows = await query(
      'INSERT INTO sos_alerts (id,user_id,latitude,longitude,address) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [uuidv4(), req.user!.userId, latitude, longitude, address ?? null],
    );
    const sos = rows[0];
    const user = await queryOne<{ name: string; mobile: string; district: string }>(
      'SELECT name,mobile,district FROM users WHERE id=$1', [req.user!.userId],
    );
    const payload = { ...sos, user };
    try { emitToAdmins('sos-alert', payload); } catch {}
    try { if (user?.district) emitToDistrict(user.district, 'sos-alert', payload); } catch {}
    success(res, payload, 201);
  } catch (err) { next(err); }
});

// GET /my — own history
router.get('/my', async (req, res, next) => {
  try {
    if (isFallback()) {
      const items = memStore.sosAlerts.filter(s => s.user_id === req.user!.userId);
      return success(res, items.slice().reverse());
    }
    const rows = await query(
      'SELECT * FROM sos_alerts WHERE user_id=$1 ORDER BY created_at DESC',
      [req.user!.userId],
    );
    success(res, rows);
  } catch (err) { next(err); }
});

// GET / — admin list all
router.get('/', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { status } = req.query as Record<string, string>;

    if (isFallback()) {
      let items = [...memStore.sosAlerts];
      if (status) items = items.filter(s => s.status === status);
      items.sort((a, b) => b.created_at.localeCompare(a.created_at));
      const total = items.length;
      return paginated(res, items.slice((page - 1) * limit, page * limit), total, page, limit);
    }

    const offset = (page - 1) * limit;
    const conds = ['1=1']; const params: unknown[] = []; let p = 1;
    if (status) { conds.push(`sa.status=$${p++}`); params.push(status); }
    const where = conds.join(' AND ');
    const [rows, countRow] = await Promise.all([
      query(`SELECT sa.*,u.name,u.mobile,u.district FROM sos_alerts sa JOIN users u ON sa.user_id=u.id WHERE ${where} ORDER BY sa.created_at DESC LIMIT $${p} OFFSET $${p+1}`, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM sos_alerts sa WHERE ${where}`, params),
    ]);
    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

// PATCH /:id — update status
router.patch('/:id', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const { status, assignedTo, notes } = req.body;
    if (isFallback()) {
      const item = memStore.sosAlerts.find(s => s.id === req.params.id);
      if (item) {
        item.status = status ?? item.status;
        item.assigned_to = assignedTo ?? item.assigned_to;
        item.notes = notes ?? item.notes;
        item.updated_at = new Date().toISOString();
      }
      return success(res, item ?? null);
    }
    const rows = await query(
      `UPDATE sos_alerts SET status=$1,assigned_to=$2,notes=$3,
       resolved_at=CASE WHEN $1='resolved' THEN NOW() ELSE resolved_at END,
       updated_at=NOW() WHERE id=$4 RETURNING *`,
      [status, assignedTo ?? null, notes ?? null, req.params.id],
    );
    success(res, rows[0]);
  } catch (err) { next(err); }
});

export default router;
