import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore, findUserById } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { emitToDistrict } from '../../infrastructure/realtime/socket.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { status, bloodGroup, district } = req.query as Record<string, string>;

    if (isFallback()) {
      let items = [...memStore.bloodRequests];
      if (status) items = items.filter(r => r.status === status);
      if (bloodGroup) items = items.filter(r => r.blood_group === bloodGroup);
      if (district) items = items.filter(r => r.district.toLowerCase().includes(district.toLowerCase()));
      const total = items.length;
      return paginated(res, items.slice((page - 1) * limit, page * limit), total, page, limit);
    }

    const offset = (page - 1) * limit;
    const conds = ['1=1']; const params: unknown[] = []; let p = 1;
    if (status) { conds.push(`br.status=$${p++}`); params.push(status); }
    if (bloodGroup) { conds.push(`br.blood_group=$${p++}`); params.push(bloodGroup); }
    if (district) { conds.push(`br.district=$${p++}`); params.push(district); }
    const where = conds.join(' AND ');
    const [rows, countRow] = await Promise.all([
      query(`SELECT br.*,u.name as requester_name,u.mobile as requester_mobile FROM blood_requests br JOIN users u ON br.requester_id=u.id WHERE ${where} ORDER BY br.created_at DESC LIMIT $${p} OFFSET $${p+1}`, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM blood_requests br WHERE ${where}`, params),
    ]);
    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { bloodGroup, unitsNeeded, hospitalName, district, state, contactMobile, notes, urgency } = req.body;
    const now = new Date().toISOString();

    if (isFallback()) {
      const user = findUserById(req.user!.userId);
      const request = { id: uuidv4(), requester_id: req.user!.userId, requester_name: user?.name ?? 'User', requester_mobile: user?.mobile ?? '', blood_group: bloodGroup, units_needed: unitsNeeded ?? 1, hospital_name: hospitalName ?? '', district: district ?? '', state: state ?? '', contact_mobile: contactMobile ?? '', notes: notes ?? '', urgency: urgency ?? 'normal', status: 'open', created_at: now, updated_at: now };
      memStore.bloodRequests.push(request);
      try { emitToDistrict(district, 'blood-request', request); } catch {}
      return success(res, request, 201);
    }

    const rows = await query('INSERT INTO blood_requests (id,requester_id,blood_group,units_needed,hospital_name,district,state,contact_mobile,notes,urgency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *', [uuidv4(), req.user!.userId, bloodGroup, unitsNeeded ?? 1, hospitalName, district, state, contactMobile, notes, urgency ?? 'normal']);
    try { emitToDistrict(district, 'blood-request', rows[0]); } catch {}
    success(res, rows[0], 201);
  } catch (err) { next(err); }
});

router.patch('/:id/status', async (req, res, next) => {
  try {
    if (isFallback()) {
      const item = memStore.bloodRequests.find(r => r.id === req.params.id);
      if (item) { item.status = req.body.status; item.updated_at = new Date().toISOString(); }
      return success(res, item ?? null);
    }
    const rows = await query('UPDATE blood_requests SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [req.body.status, req.params.id]);
    success(res, rows[0]);
  } catch (err) { next(err); }
});

export default router;
