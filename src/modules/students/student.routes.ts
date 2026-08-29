import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('super_admin', 'state_admin', 'district_admin', 'staff'));

// ── Courses CRUD ──────────────────────────────────────────────────────────────

// GET /courses
router.get('/courses', async (_req, res, next) => {
  try {
    if (isFallback()) {
      return success(res, (memStore as any).courses ?? []);
    }
    const rows = await query('SELECT * FROM courses WHERE is_active=true ORDER BY name');
    success(res, rows);
  } catch (err) { next(err); }
});

// POST /courses
router.post('/courses', async (req, res, next) => {
  try {
    const { name, description, category, duration } = req.body;
    const id = uuidv4();
    if (isFallback()) {
      const course = { id, name, description, category, duration, is_active: true, created_at: new Date().toISOString() };
      if (!(memStore as any).courses) (memStore as any).courses = [];
      (memStore as any).courses.push(course);
      return success(res, course, 201);
    }
    const rows = await query(
      'INSERT INTO courses (id, name, description, category, duration) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, name, description || null, category || null, duration || null]
    );
    success(res, rows[0], 201);
  } catch (err) { next(err); }
});

// PUT /courses/:id
router.put('/courses/:id', async (req, res, next) => {
  try {
    const { name, description, category, duration, isActive } = req.body;
    if (isFallback()) {
      const courses = (memStore as any).courses ?? [];
      const course = courses.find((c: any) => c.id === req.params.id);
      if (course) {
        if (name !== undefined) course.name = name;
        if (description !== undefined) course.description = description;
        if (category !== undefined) course.category = category;
        if (duration !== undefined) course.duration = duration;
        if (isActive !== undefined) course.is_active = isActive;
      }
      return success(res, course);
    }
    const updates: string[] = []; const params: unknown[] = []; let p = 1;
    if (name !== undefined) { updates.push(`name=$${p++}`); params.push(name); }
    if (description !== undefined) { updates.push(`description=$${p++}`); params.push(description); }
    if (category !== undefined) { updates.push(`category=$${p++}`); params.push(category); }
    if (duration !== undefined) { updates.push(`duration=$${p++}`); params.push(duration); }
    if (isActive !== undefined) { updates.push(`is_active=$${p++}`); params.push(isActive); }
    if (!updates.length) return success(res, null);
    params.push(req.params.id);
    const rows = await query(`UPDATE courses SET ${updates.join(',')} WHERE id=$${p} RETURNING *`, params);
    success(res, rows[0]);
  } catch (err) { next(err); }
});

// DELETE /courses/:id
router.delete('/courses/:id', async (req, res, next) => {
  try {
    if (isFallback()) {
      if ((memStore as any).courses) {
        (memStore as any).courses = (memStore as any).courses.filter((c: any) => c.id !== req.params.id);
      }
      return success(res, { deleted: true });
    }
    await query('UPDATE courses SET is_active=false WHERE id=$1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

// ── Students CRUD ─────────────────────────────────────────────────────────────

// GET /
router.get('/', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { search, courseId, status } = req.query as Record<string, string>;

    if (isFallback()) {
      let items = (memStore as any).students ?? [];
      if (search) items = items.filter((s: any) => s.name.toLowerCase().includes(search.toLowerCase()) || s.mobile?.includes(search));
      if (courseId) items = items.filter((s: any) => s.course_id === courseId);
      if (status) items = items.filter((s: any) => s.status === status);
      const total = items.length;
      return paginated(res, items.slice((page - 1) * limit, page * limit), total, page, limit);
    }

    const offset = (page - 1) * limit;
    const conds: string[] = ['1=1']; const params: unknown[] = []; let p = 1;
    if (search) { conds.push(`(s.name ILIKE $${p} OR s.mobile LIKE $${p})`); params.push(`%${search}%`); p++; }
    if (courseId) { conds.push(`s.course_id=$${p++}`); params.push(courseId); }
    if (status) { conds.push(`s.status=$${p++}`); params.push(status); }
    const where = conds.join(' AND ');

    const [rows, countRow] = await Promise.all([
      query(`SELECT s.*, c.name as course_name FROM students s LEFT JOIN courses c ON s.course_id=c.id WHERE ${where} ORDER BY s.created_at DESC LIMIT $${p} OFFSET $${p+1}`, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM students s WHERE ${where}`, params),
    ]);
    paginated(res, rows, parseInt(countRow?.count ?? '0'), page, limit);
  } catch (err) { next(err); }
});

// GET /stats — detailed analytics
router.get('/stats', async (_req, res, next) => {
  try {
    if (isFallback()) {
      return success(res, { total: 0, active: 0, completed: 0, inactive: 0, dropped: 0, courseWise: [], districtWise: [], statusBreakdown: [], monthlyEnrollments: [] });
    }
    const [total, active, completed, inactive, dropped, courseWise, districtWise, statusBreakdown, monthlyEnrollments] = await Promise.all([
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM students'),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM students WHERE status=$1', ['active']),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM students WHERE status=$1', ['completed']),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM students WHERE status=$1', ['inactive']),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM students WHERE status=$1', ['dropped']),
      query(`SELECT c.name as course, COUNT(s.id) as count FROM students s JOIN courses c ON s.course_id=c.id GROUP BY c.name ORDER BY count DESC`),
      query(`SELECT COALESCE(district, 'Unknown') as district, COUNT(*) as count FROM students WHERE district IS NOT NULL AND district != '' GROUP BY district ORDER BY count DESC LIMIT 10`),
      query(`SELECT status, COUNT(*) as count FROM students GROUP BY status ORDER BY count DESC`),
      query(`SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YYYY') as month, COUNT(*) as count FROM students WHERE created_at > NOW() - INTERVAL '6 months' GROUP BY DATE_TRUNC('month', created_at) ORDER BY DATE_TRUNC('month', created_at)`),
    ]);
    success(res, {
      total: parseInt(total?.count ?? '0'),
      active: parseInt(active?.count ?? '0'),
      completed: parseInt(completed?.count ?? '0'),
      inactive: parseInt(inactive?.count ?? '0'),
      dropped: parseInt(dropped?.count ?? '0'),
      courseWise,
      districtWise,
      statusBreakdown,
      monthlyEnrollments,
    });
  } catch (err) { next(err); }
});

// POST /
router.post('/', async (req, res, next) => {
  try {
    const name = req.body.name;
    const mobile = req.body.mobile;
    const email = req.body.email;
    const fatherName = req.body.fatherName ?? req.body.father_name;
    const address = req.body.address;
    const district = req.body.district;
    const state = req.body.state;
    const courseId = req.body.courseId ?? req.body.course_id;
    const batch = req.body.batch;
    const notes = req.body.notes;
    const id = uuidv4();
    const now = new Date().toISOString();

    if (isFallback()) {
      const student = { id, name, mobile, email, father_name: fatherName, address, district, state, course_id: courseId, batch, status: 'active', notes, created_by: req.user!.userId, created_at: now, updated_at: now };
      if (!(memStore as any).students) (memStore as any).students = [];
      (memStore as any).students.push(student);
      return success(res, student, 201);
    }

    const rows = await query(
      `INSERT INTO students (id, name, mobile, email, father_name, address, district, state, course_id, batch, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [id, name, mobile || null, email || null, fatherName || null, address || null, district || null, state || null, courseId || null, batch || null, notes || null, req.user!.userId]
    );
    success(res, rows[0], 201);
  } catch (err) { next(err); }
});

// PUT /:id
router.put('/:id', async (req, res, next) => {
  try {
    const name = req.body.name;
    const mobile = req.body.mobile;
    const email = req.body.email;
    const fatherName = req.body.fatherName ?? req.body.father_name;
    const address = req.body.address;
    const district = req.body.district;
    const state = req.body.state;
    const courseId = req.body.courseId ?? req.body.course_id;
    const batch = req.body.batch;
    const status = req.body.status;
    const notes = req.body.notes;
    if (isFallback()) {
      const students = (memStore as any).students ?? [];
      const student = students.find((s: any) => s.id === req.params.id);
      if (student) {
        if (name !== undefined) student.name = name;
        if (mobile !== undefined) student.mobile = mobile;
        if (email !== undefined) student.email = email;
        if (fatherName !== undefined) student.father_name = fatherName;
        if (address !== undefined) student.address = address;
        if (district !== undefined) student.district = district;
        if (state !== undefined) student.state = state;
        if (courseId !== undefined) student.course_id = courseId;
        if (batch !== undefined) student.batch = batch;
        if (status !== undefined) student.status = status;
        if (notes !== undefined) student.notes = notes;
        student.updated_at = new Date().toISOString();
      }
      return success(res, student);
    }

    const updates: string[] = []; const params: unknown[] = []; let p = 1;
    if (name !== undefined) { updates.push(`name=$${p++}`); params.push(name); }
    if (mobile !== undefined) { updates.push(`mobile=$${p++}`); params.push(mobile); }
    if (email !== undefined) { updates.push(`email=$${p++}`); params.push(email); }
    if (fatherName !== undefined) { updates.push(`father_name=$${p++}`); params.push(fatherName); }
    if (address !== undefined) { updates.push(`address=$${p++}`); params.push(address); }
    if (district !== undefined) { updates.push(`district=$${p++}`); params.push(district); }
    if (state !== undefined) { updates.push(`state=$${p++}`); params.push(state); }
    if (courseId !== undefined) { updates.push(`course_id=$${p++}`); params.push(courseId); }
    if (batch !== undefined) { updates.push(`batch=$${p++}`); params.push(batch); }
    if (status !== undefined) { updates.push(`status=$${p++}`); params.push(status); }
    if (notes !== undefined) { updates.push(`notes=$${p++}`); params.push(notes); }
    if (!updates.length) return success(res, null);
    updates.push(`updated_at=NOW()`);
    params.push(req.params.id);
    const rows = await query(`UPDATE students SET ${updates.join(',')} WHERE id=$${p} RETURNING *`, params);
    success(res, rows[0]);
  } catch (err) { next(err); }
});

// DELETE /:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (isFallback()) {
      if ((memStore as any).students) {
        (memStore as any).students = (memStore as any).students.filter((s: any) => s.id !== req.params.id);
      }
      return success(res, { deleted: true });
    }
    await query('DELETE FROM students WHERE id=$1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

export default router;
