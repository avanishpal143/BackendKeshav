import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore, findUserById } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';

const router = Router();
router.use(authenticate);

// GET /settings — must come before /me to avoid /:id catching it
router.get('/settings', async (req, res, next) => {
  try {
    if (isFallback()) {
      const user = findUserById(req.user!.userId);
      const defaultSettings = {
        push_notifications: true,
        location_services: true,
        dark_mode: false,
        language: 'Hindi',
        biometric_auth: false,
        auto_backup: true,
        session_timeout: 30,
      };
      return success(res, { ...defaultSettings, ...(user?.settings ?? {}) });
    }
    const user = await queryOne<{ settings: Record<string, unknown> | null }>('SELECT settings FROM users WHERE id=$1', [req.user!.userId]).catch(() => null);
    const defaultSettings = {
      push_notifications: true,
      location_services: true,
      dark_mode: false,
      language: 'Hindi',
      biometric_auth: false,
      auto_backup: true,
      session_timeout: 30,
    };
    success(res, { ...defaultSettings, ...(user?.settings ?? {}) });
  } catch (err) { next(err); }
});

// PUT /settings
router.put('/settings', async (req, res, next) => {
  try {
    const allowedSettings = [
      'push_notifications', 'location_services', 'dark_mode', 'language',
      'biometric_auth', 'auto_backup', 'session_timeout',
    ];
    const settings: Record<string, unknown> = {};
    for (const key of allowedSettings) {
      if (req.body[key] !== undefined) settings[key] = req.body[key];
    }

    if (isFallback()) {
      const user = findUserById(req.user!.userId);
      if (user) {
        user.settings = { ...(user.settings ?? {}), ...settings };
      }
      return success(res, { message: 'Settings updated successfully', settings: user?.settings ?? settings });
    }

    await query(
      `UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
      [req.user!.userId, JSON.stringify(settings)],
    ).catch(() => {});
    success(res, { message: 'Settings updated successfully', settings });
  } catch (err) { next(err); }
});

// GET /stats/summary — must come before /:id
router.get('/stats/summary', requireRole('super_admin', 'state_admin', 'district_admin'), async (_req, res, next) => {
  try {
    if (isFallback()) {
      const roles = ['user', 'staff', 'volunteer', 'district_admin', 'state_admin', 'super_admin'];
      const stats = roles.map(r => ({ role: r, count: String(memStore.users.filter(u => u.role === r).length) }));
      return success(res, stats);
    }
    const rows = await query<{ role: string; count: string }>('SELECT role, COUNT(*) as count FROM users GROUP BY role');
    success(res, rows);
  } catch (err) { next(err); }
});

// GET /me
router.get('/me', async (req, res, next) => {
  try {
    if (isFallback()) {
      const user = findUserById(req.user!.userId);
      return success(res, user);
    }
    const user = await queryOne('SELECT * FROM users WHERE id=$1', [req.user!.userId]);
    success(res, user);
  } catch (err) { next(err); }
});

// POST /fcm-token — register/update FCM push token
router.post('/fcm-token', async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token required' });

    if (isFallback()) {
      const user = findUserById(req.user!.userId);
      if (user) user.fcm_token = token;
      return success(res, { updated: true });
    }

    await query('UPDATE users SET fcm_token=$1 WHERE id=$2', [token, req.user!.userId]);
    success(res, { updated: true });
  } catch (err) { next(err); }
});

// PUT /me
router.put('/me', async (req, res, next) => {
  try {
    if (isFallback()) {
      const user = findUserById(req.user!.userId);
      if (user) {
        if (req.body.name !== undefined) user.name = req.body.name;
        if (req.body.district !== undefined) user.district = req.body.district;
        if (req.body.state !== undefined) user.state = req.body.state;
        if (req.body.blood_group !== undefined) user.blood_group = req.body.blood_group;
        if (req.body.fcm_token !== undefined) user.fcm_token = req.body.fcm_token;
        if (req.body.avatar_url !== undefined) user.avatar_url = req.body.avatar_url;
      }
      return success(res, user);
    }
    const allowed = ['name', 'avatar_url', 'district', 'state', 'village', 'address', 'blood_group', 'fcm_token'];
    const data: Record<string, unknown> = {};
    for (const key of allowed) { if (req.body[key] !== undefined) data[key] = req.body[key]; }
    const keys = Object.keys(data);
    if (keys.length === 0) {
      const u = await queryOne('SELECT * FROM users WHERE id=$1', [req.user!.userId]);
      return success(res, u);
    }
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const rows = await query(`UPDATE users SET ${sets}, updated_at=NOW() WHERE id=$1 RETURNING *`, [req.user!.userId, ...Object.values(data)]);
    success(res, rows[0]);
  } catch (err) { next(err); }
});

// GET / — admin list
router.get('/', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { district, search, role } = req.query as Record<string, string>;

    if (isFallback()) {
      let items = [...memStore.users];
      if (district) items = items.filter(u => u.district.toLowerCase().includes(district.toLowerCase()));
      if (role) items = items.filter(u => u.role === role);
      if (search) items = items.filter(u =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.mobile.includes(search) ||
        u.member_id.toLowerCase().includes(search.toLowerCase()),
      );
      const total = items.length;
      const data = items.slice((page - 1) * limit, page * limit);
      return paginated(res, data, total, page, limit);
    }

    const offset = (page - 1) * limit;
    const conds: string[] = ['1=1']; const params: unknown[] = []; let p = 1;
    if (district) { conds.push(`district=$${p++}`); params.push(district); }
    if (role) { conds.push(`role=$${p++}`); params.push(role); }
    if (search) { conds.push(`(name ILIKE $${p} OR mobile ILIKE $${p} OR member_id ILIKE $${p})`); params.push(`%${search}%`); p++; }
    const where = conds.join(' AND ');
    const [rows, countRow] = await Promise.all([
      query(
        `SELECT id,name,mobile,email,role,district,state,blood_group,member_id,is_active,is_verified,created_at FROM users WHERE ${where} ORDER BY created_at DESC LIMIT $${p} OFFSET $${p + 1}`,
        [...params, limit, offset],
      ),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM users WHERE ${where}`, params),
    ]);
    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

// GET /:id
router.get('/:id', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    if (isFallback()) return success(res, findUserById(String(req.params.id)));
    const user = await queryOne('SELECT * FROM users WHERE id=$1', [req.params.id]);
    success(res, user);
  } catch (err) { next(err); }
});

// PATCH /:id/toggle-active
router.patch('/:id/toggle-active', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    if (isFallback()) {
      const user = findUserById(String(req.params.id));
      if (user) user.is_active = !user.is_active;
      return success(res, user ? { id: user.id, is_active: user.is_active } : null);
    }
    const rows = await query('UPDATE users SET is_active=NOT is_active WHERE id=$1 RETURNING id,is_active', [req.params.id]);
    success(res, rows[0]);
  } catch (err) { next(err); }
});

export default router;
