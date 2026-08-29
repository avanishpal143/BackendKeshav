import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore, findUserById } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { district } = req.query as Record<string, string>;

    if (isFallback()) {
      let items = memStore.staff.filter(s => s.is_active);
      if (district) items = items.filter(s => s.district.toLowerCase().includes(district.toLowerCase()));
      const total = items.length;
      return paginated(res, items.slice((page - 1) * limit, page * limit), total, page, limit);
    }

    const offset = (page - 1) * limit;
    const conds = ['s.is_active=true']; const params: unknown[] = []; let p = 1;
    if (district) { conds.push(`s.district=$${p++}`); params.push(district); }
    const where = conds.join(' AND ');
    const [rows, countRow] = await Promise.all([
      query(`SELECT s.id, s.designation, s.department, s.district, s.state, s.is_active, u.name, u.mobile, u.role,
             CASE WHEN u.avatar_url LIKE 'http%' THEN u.avatar_url ELSE NULL END as avatar_url
             FROM staff s JOIN users u ON s.user_id=u.id WHERE ${where} ORDER BY u.name LIMIT $${p} OFFSET $${p + 1}`, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM staff s WHERE ${where}`, params),
    ]);
    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

router.post('/', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const { userId, designation, department, district, state } = req.body;
    if (isFallback()) {
      const user = findUserById(userId);
      if (user) user.role = 'staff';
      const item = { id: uuidv4(), user_id: userId, name: user?.name ?? '', mobile: user?.mobile ?? '', designation: designation ?? '', department: department ?? '', district: district ?? '', state: state ?? '', is_active: true, role: 'staff', avatar_url: null };
      memStore.staff.push(item);
      return success(res, item, 201);
    }
    const rows = await query('INSERT INTO staff (id,user_id,designation,department,district,state) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [uuidv4(), userId, designation, department, district, state]);
    await query('UPDATE users SET role=$1 WHERE id=$2', ['staff', userId]);
    success(res, rows[0], 201);
  } catch (err) { next(err); }
});

// POST /staff/direct — Add staff directly with password and permissions
router.post('/direct', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const { name, mobile, designation, department, district, state, avatar_url, password, permissions } = req.body;
    if (!name || !mobile) {
      return res.status(400).json({ success: false, message: 'Name and mobile are required' });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ success: false, message: 'Password must be at least 4 characters' });
    }

    const id = uuidv4();
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.default.hash(password, 10);

    if (isFallback()) {
      const item = {
        id, user_id: id, name, mobile, password_hash: passwordHash,
        designation: designation ?? '', department: department ?? '',
        district: district ?? '', state: state ?? '',
        is_active: true, role: 'staff', avatar_url: avatar_url ?? null,
        permissions: permissions ?? [],
      };
      memStore.staff.push(item);
      return success(res, { ...item, password_hash: undefined }, 201);
    }

    // Create/update user with password
    const userId = uuidv4();
    await query(
      `INSERT INTO users (id, name, mobile, role, district, state, avatar_url, password_hash, is_active, is_verified)
       VALUES ($1, $2, $3, 'staff', $4, $5, $6, $7, true, true)
       ON CONFLICT (mobile) DO UPDATE SET name=$2, role='staff', district=$4, state=$5, avatar_url=COALESCE($6, users.avatar_url), password_hash=$7
       RETURNING id`,
      [userId, name, mobile, district ?? null, state ?? null, avatar_url ?? null, passwordHash]
    );

    const existingUser = await queryOne<{ id: string }>(`SELECT id FROM users WHERE mobile=$1`, [mobile]);
    const finalUserId = existingUser?.id ?? userId;

    await query(
      `INSERT INTO staff (id, user_id, designation, department, district, state)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET designation=$3, department=$4, district=$5, state=$6, is_active=true`,
      [id, finalUserId, designation ?? '', department ?? '', district ?? '', state ?? '']
    );

    // Save permissions
    if (permissions && Array.isArray(permissions)) {
      // Clear old permissions
      await query('DELETE FROM staff_permissions WHERE user_id=$1', [finalUserId]);
      // Insert new permissions
      for (const perm of permissions) {
        if (perm.module) {
          await query(
            'INSERT INTO staff_permissions (user_id, module, can_read, can_write) VALUES ($1, $2, $3, $4)',
            [finalUserId, perm.module, perm.canRead ?? true, perm.canWrite ?? false]
          );
        }
      }
    }

    const result = { id, user_id: finalUserId, name, mobile, designation, department, district, state, avatar_url, is_active: true, permissions };
    success(res, result, 201);
  } catch (err) { next(err); }
});

// PATCH /staff/:id/toggle — Enable/disable staff account
router.patch('/:id/toggle', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const { active } = req.body;
    if (isFallback()) {
      const item = memStore.staff.find(s => s.id === req.params.id);
      if (item) item.is_active = active;
      return success(res, { active });
    }
    // Get user_id from staff
    const staff = await queryOne<{ user_id: string }>('SELECT user_id FROM staff WHERE id=$1', [req.params.id]);
    if (staff) {
      await query('UPDATE staff SET is_active=$1 WHERE id=$2', [active, req.params.id]);
      await query('UPDATE users SET is_active=$1 WHERE id=$2', [active, staff.user_id]);
    }
    success(res, { active, message: active ? 'Staff account activated' : 'Staff account disabled' });
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    if (isFallback()) {
      const item = memStore.staff.find(s => s.id === req.params.id);
      if (item) item.is_active = false;
      return success(res, { removed: true });
    }
    await query('UPDATE staff SET is_active=false WHERE id=$1', [req.params.id]);
    success(res, { removed: true });
  } catch (err) { next(err); }
});

export default router;
