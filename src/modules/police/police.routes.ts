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
      let items = memStore.policeStations.filter(p => p.is_active);
      if (district) items = items.filter(p => p.district.toLowerCase().includes(district.toLowerCase()));
      if (state) items = items.filter(p => p.state.toLowerCase() === state.toLowerCase());
      const total = items.length;
      return paginated(res, items.slice((page - 1) * limit, page * limit), total, page, limit);
    }

    const offset = (page - 1) * limit;
    const conds = ['is_active=true']; const params: unknown[] = []; let p = 1;
    if (district) { conds.push(`district ILIKE $${p++}`); params.push(`%${district}%`); }
    if (state) { conds.push(`state=$${p++}`); params.push(state); }
    const where = conds.join(' AND ');
    const [rows, countRow] = await Promise.all([
      query(`SELECT * FROM police_stations WHERE ${where} ORDER BY name LIMIT $${p} OFFSET $${p+1}`, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM police_stations WHERE ${where}`, params),
    ]);
    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

router.post('/', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const { name, type, district, state, phone, address, latitude, longitude } = req.body;
    if (isFallback()) {
      const item = { id: uuidv4(), name, type: type ?? 'Police Station', district, state, phone, address, latitude: latitude ?? 0, longitude: longitude ?? 0, is_active: true };
      memStore.policeStations.push(item);
      return success(res, item, 201);
    }
    const rows = await query('INSERT INTO police_stations (id,name,type,district,state,phone,address,latitude,longitude) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [uuidv4(), name, type ?? 'Police Station', district, state, phone, address, latitude, longitude]);
    success(res, rows[0], 201);
  } catch (err) { next(err); }
});

router.put('/:id', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const { name, phone, address, latitude, longitude } = req.body;
    if (isFallback()) {
      const item = memStore.policeStations.find(p => p.id === req.params.id);
      if (item) { Object.assign(item, { name: name ?? item.name, phone: phone ?? item.phone, address: address ?? item.address }); }
      return success(res, item ?? null);
    }
    const rows = await query('UPDATE police_stations SET name=$1,phone=$2,address=$3,latitude=$4,longitude=$5 WHERE id=$6 RETURNING *', [name, phone, address, latitude, longitude, req.params.id]);
    success(res, rows[0]);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('super_admin'), async (req, res, next) => {
  try {
    if (isFallback()) {
      const item = memStore.policeStations.find(p => p.id === req.params.id);
      if (item) item.is_active = false;
      return success(res, { deleted: true });
    }
    await query('UPDATE police_stations SET is_active=false WHERE id=$1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

export default router;
