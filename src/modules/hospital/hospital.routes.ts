import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { district, state } = req.query as Record<string, string>;

    if (isFallback()) {
      let items = memStore.hospitals.filter(h => h.is_active);
      if (district) items = items.filter(h => h.district.toLowerCase().includes(district.toLowerCase()));
      if (state) items = items.filter(h => h.state.toLowerCase() === state.toLowerCase());
      const total = items.length;
      return paginated(res, items.slice((page - 1) * limit, page * limit), total, page, limit);
    }

    const offset = (page - 1) * limit;
    const conds = ['is_active=true']; const params: unknown[] = []; let p = 1;
    if (district) { conds.push(`district ILIKE $${p++}`); params.push(`%${district}%`); }
    if (state) { conds.push(`state=$${p++}`); params.push(state); }
    const where = conds.join(' AND ');
    const [rows, countRow] = await Promise.all([
      query(`SELECT * FROM hospitals WHERE ${where} ORDER BY name LIMIT $${p} OFFSET $${p+1}`, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM hospitals WHERE ${where}`, params),
    ]);
    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

router.post('/', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const { name, type, district, state, phone, address, latitude, longitude, beds } = req.body;
    if (isFallback()) {
      const item = { id: uuidv4(), name, type: type ?? 'Government Hospital', district, state, phone, address, latitude: latitude ?? 0, longitude: longitude ?? 0, beds: beds ?? 0, is_active: true };
      memStore.hospitals.push(item);
      return success(res, item, 201);
    }
    const rows = await query('INSERT INTO hospitals (id,name,type,district,state,phone,address,latitude,longitude,beds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [uuidv4(), name, type ?? 'Government Hospital', district, state, phone, address, latitude, longitude, beds ?? null]);
    success(res, rows[0], 201);
  } catch (err) { next(err); }
});

router.put('/:id', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const { name, phone, address, beds } = req.body;
    if (isFallback()) {
      const item = memStore.hospitals.find(h => h.id === req.params.id);
      if (item) Object.assign(item, { name: name ?? item.name, phone: phone ?? item.phone, address: address ?? item.address, beds: beds ?? item.beds });
      return success(res, item ?? null);
    }
    const rows = await query('UPDATE hospitals SET name=$1,phone=$2,address=$3,beds=$4 WHERE id=$5 RETURNING *', [name, phone, address, beds, req.params.id]);
    success(res, rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('super_admin'), async (req, res, next) => {
  try {
    if (isFallback()) {
      const item = memStore.hospitals.find(h => h.id === req.params.id);
      if (item) item.is_active = false;
      return success(res, { deleted: true });
    }
    await query('UPDATE hospitals SET is_active=false WHERE id=$1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

export default router;
