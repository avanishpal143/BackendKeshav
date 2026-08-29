import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';

const router = Router();
router.use(authenticate);

// GET / — list donors
router.get('/', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { bloodGroup, district, available } = req.query as Record<string, string>;

    if (isFallback()) {
      let items = [...memStore.bloodDonors];
      if (bloodGroup) items = items.filter(d => d.blood_group === bloodGroup);
      if (district) items = items.filter(d => d.district.toLowerCase().includes(district.toLowerCase()));
      if (available === 'true') items = items.filter(d => d.is_available);
      const total = items.length;
      return paginated(res, items.slice((page - 1) * limit, page * limit), total, page, limit);
    }

    const offset = (page - 1) * limit;
    const conds = ['1=1']; const params: unknown[] = []; let p = 1;
    if (bloodGroup) { conds.push(`bd.blood_group=$${p++}`); params.push(bloodGroup); }
    if (district) { conds.push(`bd.district=$${p++}`); params.push(district); }
    if (available === 'true') conds.push('bd.is_available=true');
    const where = conds.join(' AND ');
    const [rows, countRow] = await Promise.all([
      query(`SELECT bd.*,u.name,u.mobile,u.avatar_url FROM blood_donors bd JOIN users u ON bd.user_id=u.id WHERE ${where} ORDER BY bd.updated_at DESC LIMIT $${p} OFFSET $${p+1}`, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM blood_donors bd WHERE ${where}`, params),
    ]);
    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

// POST /register
router.post('/register', async (req, res, next) => {
  try {
    const { bloodGroup, district, state, latitude, longitude } = req.body;
    if (isFallback()) {
      const existing = memStore.bloodDonors.find(d => d.user_id === req.user!.userId);
      if (existing) {
        existing.blood_group = bloodGroup ?? existing.blood_group;
        existing.district = district ?? existing.district;
        existing.is_available = true;
        return success(res, existing);
      }
      const user = memStore.users.find(u => u.id === req.user!.userId);
      const donor = { id: uuidv4(), user_id: req.user!.userId, name: user?.name ?? 'User', mobile: user?.mobile ?? '', blood_group: bloodGroup, is_available: true, last_donated_at: null, district: district ?? '', state: state ?? '', latitude: latitude ?? 0, longitude: longitude ?? 0, created_at: new Date().toISOString() };
      memStore.bloodDonors.push(donor);
      return success(res, donor, 201);
    }
    const existing = await queryOne('SELECT id FROM blood_donors WHERE user_id=$1', [req.user!.userId]);
    if (existing) {
      const rows = await query('UPDATE blood_donors SET blood_group=$1,district=$2,state=$3,latitude=$4,longitude=$5,is_available=true,updated_at=NOW() WHERE user_id=$6 RETURNING *', [bloodGroup, district, state, latitude, longitude, req.user!.userId]);
      return success(res, rows[0]);
    }
    const rows = await query('INSERT INTO blood_donors (id,user_id,blood_group,district,state,latitude,longitude) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [uuidv4(), req.user!.userId, bloodGroup, district, state, latitude, longitude]);
    success(res, rows[0], 201);
  } catch (err) { next(err); }
});

// PATCH /availability
router.patch('/availability', async (req, res, next) => {
  try {
    if (isFallback()) {
      const donor = memStore.bloodDonors.find(d => d.user_id === req.user!.userId);
      if (donor) donor.is_available = !donor.is_available;
      return success(res, donor);
    }
    const rows = await query('UPDATE blood_donors SET is_available=NOT is_available WHERE user_id=$1 RETURNING *', [req.user!.userId]);
    success(res, rows[0]);
  } catch (err) { next(err); }
});

// GET /stats
router.get('/stats', async (_req, res, next) => {
  try {
    if (isFallback()) {
      const groups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      const stats = groups.map(g => ({
        blood_group: g,
        total: String(memStore.bloodDonors.filter(d => d.blood_group === g).length),
        available: String(memStore.bloodDonors.filter(d => d.blood_group === g && d.is_available).length),
      })).filter(s => parseInt(s.total) > 0);
      return success(res, stats);
    }
    const rows = await query(`SELECT blood_group, COUNT(*) as total, SUM(CASE WHEN is_available THEN 1 ELSE 0 END) as available FROM blood_donors GROUP BY blood_group ORDER BY blood_group`);
    success(res, rows);
  } catch (err) { next(err); }
});

export default router;
