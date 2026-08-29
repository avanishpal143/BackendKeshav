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
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const isAdmin = ['super_admin', 'state_admin', 'district_admin', 'staff'].includes(req.user!.role);

    if (isFallback()) {
      let items = isAdmin ? [...memStore.complaints] : memStore.complaints.filter(c => c.user_id === req.user!.userId);
      if (req.query.status) items = items.filter(c => c.status === req.query.status);
      if (req.query.district) items = items.filter(c => c.district.toLowerCase().includes(String(req.query.district).toLowerCase()));
      const total = items.length;
      return paginated(res, items.slice((page - 1) * limit, page * limit), total, page, limit);
    }

    const offset = (page - 1) * limit;
    const conds: string[] = []; const params: unknown[] = []; let p = 1;
    if (!isAdmin) { conds.push(`c.user_id=$${p++}`); params.push(req.user!.userId); }
    if (req.query.status) { conds.push(`c.status=$${p++}`); params.push(req.query.status); }
    if (req.query.district) { conds.push(`c.district=$${p++}`); params.push(req.query.district); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const [rows, countRow] = await Promise.all([
      query(`SELECT c.*,u.name as user_name FROM complaints c JOIN users u ON c.user_id=u.id ${where} ORDER BY c.created_at DESC LIMIT $${p} OFFSET $${p+1}`, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM complaints c ${where}`, params),
    ]);
    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (isFallback()) {
      const item = memStore.complaints.find(c => c.id === req.params.id);
      return success(res, item ?? null);
    }
    const [complaint, timeline] = await Promise.all([
      queryOne(`SELECT c.*,u.name as user_name FROM complaints c JOIN users u ON c.user_id=u.id WHERE c.id=$1`, [req.params.id]),
      query(`SELECT ct.*,u.name as actor_name FROM complaint_timeline ct LEFT JOIN users u ON ct.actor_id=u.id WHERE ct.complaint_id=$1 ORDER BY ct.created_at`, [req.params.id]),
    ]);
    success(res, { ...complaint, timeline });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { title, description, category, district, state, village } = req.body;
    const now = new Date().toISOString();
    const user = memStore.users.find(u => u.id === req.user!.userId);

    if (isFallback()) {
      const complaint = { id: uuidv4(), user_id: req.user!.userId, user_name: user?.name ?? 'User', title, description: description ?? '', category: category ?? 'Civic', status: 'open', district: district ?? '', state: state ?? '', village: village ?? '', created_at: now, updated_at: now, timeline: [{ action: 'Complaint submitted', created_at: now }] };
      memStore.complaints.push(complaint);
      return success(res, complaint, 201);
    }

    const rows = await query('INSERT INTO complaints (id,user_id,title,description,category,district,state,village) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [uuidv4(), req.user!.userId, title, description, category, district, state, village]);
    const complaint = rows[0];
    await query('INSERT INTO complaint_timeline (id,complaint_id,action,actor_id) VALUES ($1,$2,$3,$4)', [uuidv4(), complaint.id, 'Complaint submitted', req.user!.userId]);
    success(res, complaint, 201);
  } catch (err) { next(err); }
});

router.patch('/:id/status', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    if (isFallback()) {
      const item = memStore.complaints.find(c => c.id === req.params.id);
      if (item) {
        item.status = status;
        item.updated_at = new Date().toISOString();
        item.timeline.push({ action: notes || `Status updated to ${status}`, created_at: new Date().toISOString() });
      }
      return success(res, item ?? null);
    }
    const rows = await query(`UPDATE complaints SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *`, [status, req.params.id]);
    await query('INSERT INTO complaint_timeline (id,complaint_id,action,actor_id) VALUES ($1,$2,$3,$4)', [uuidv4(), req.params.id, notes || `Status updated to ${status}`, req.user!.userId]);
    success(res, rows[0]);
  } catch (err) { next(err); }
});

export default router;
