import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { uploadToR2, uploadBase64ToR2 } from '../../infrastructure/storage/r2.js';
import { logger } from '../../shared/logger.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, fieldSize: 50 * 1024 * 1024 } });

// In-memory stores
if (!(memStore as any).educationForms) (memStore as any).educationForms = [] as any[];
if (!(memStore as any).educationSettings) (memStore as any).educationSettings = { formEnabled: true };

// ══════════════════════════════════════════════════════════════════════════════
// COURSES
// ══════════════════════════════════════════════════════════════════════════════

// GET /education/courses — Public: list all active courses
router.get('/courses', async (req, res, next) => {
  try {
    const category = req.query.category as string || '';
    let where = 'WHERE is_active=true';
    const params: any[] = [];
    if (category) { where += ' AND category=$1'; params.push(category); }

    const rows = await query(
      `SELECT * FROM courses ${where} ORDER BY sort_order ASC, created_at DESC`,
      params
    );
    success(res, rows);
  } catch (err) { next(err); }
});

// GET /education/courses/:id — Public: single course with lectures
router.get('/courses/:id', async (req, res, next) => {
  try {
    const course = await queryOne('SELECT * FROM courses WHERE id=$1', [req.params.id]);
    if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

    const lectures = await query(
      'SELECT * FROM lectures WHERE course_id=$1 AND is_active=true ORDER BY sort_order ASC, created_at ASC',
      [req.params.id]
    );
    success(res, { ...course, lectures });
  } catch (err) { next(err); }
});

// GET /education/categories — Public: list unique categories
router.get('/categories', async (_req, res, next) => {
  try {
    const rows = await query('SELECT DISTINCT category FROM courses WHERE is_active=true ORDER BY category');
    success(res, rows.map((r: any) => r.category));
  } catch (err) { next(err); }
});

// POST /education/courses — Admin: create course
router.post('/courses', authenticate, requireRole('super_admin', 'state_admin', 'staff'),
  upload.single('thumbnail'), async (req, res, next) => {
  try {
    const { title, category, description, instructor, startDate, sortOrder } = req.body;
    if (!title || !category) return res.status(400).json({ success: false, message: 'Title and category required' });

    let thumbnailUrl: string | null = null;
    if (req.file) {
      thumbnailUrl = await uploadToR2(req.file.buffer, req.file.originalname, 'education/courses', req.file.mimetype);
    } else if (req.body.thumbnailBase64) {
      thumbnailUrl = await uploadBase64ToR2(req.body.thumbnailBase64, 'education/courses');
    }

    const id = uuidv4();
    await query(
      `INSERT INTO courses (id, title, category, description, thumbnail_url, instructor, start_date, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, title, category, description || null, thumbnailUrl, instructor || null, startDate || null, parseInt(sortOrder) || 0]
    );

    logger.info(`[Education] Course created: ${title} (${category})`);
    success(res, { id, title, category, thumbnail_url: thumbnailUrl }, 201);
  } catch (err) { next(err); }
});

// PUT /education/courses/:id — Admin: update course
router.put('/courses/:id', authenticate, requireRole('super_admin', 'state_admin', 'staff'),
  upload.single('thumbnail'), async (req, res, next) => {
  try {
    const { title, category, description, instructor, startDate, sortOrder, isActive } = req.body;
    const updates: string[] = []; const params: any[] = []; let p = 1;

    if (title !== undefined) { updates.push(`title=$${p++}`); params.push(title); }
    if (category !== undefined) { updates.push(`category=$${p++}`); params.push(category); }
    if (description !== undefined) { updates.push(`description=$${p++}`); params.push(description); }
    if (instructor !== undefined) { updates.push(`instructor=$${p++}`); params.push(instructor); }
    if (startDate !== undefined) { updates.push(`start_date=$${p++}`); params.push(startDate || null); }
    if (sortOrder !== undefined) { updates.push(`sort_order=$${p++}`); params.push(parseInt(sortOrder)); }
    if (isActive !== undefined) { updates.push(`is_active=$${p++}`); params.push(isActive); }

    // Handle thumbnail upload
    let thumbnailUrl: string | null = null;
    if (req.file) {
      thumbnailUrl = await uploadToR2(req.file.buffer, req.file.originalname, 'education/courses', req.file.mimetype);
    } else if (req.body.thumbnailBase64) {
      thumbnailUrl = await uploadBase64ToR2(req.body.thumbnailBase64, 'education/courses');
    }
    if (thumbnailUrl) { updates.push(`thumbnail_url=$${p++}`); params.push(thumbnailUrl); }

    updates.push(`updated_at=NOW()`);

    if (updates.length > 1) {
      params.push(req.params.id);
      await query(`UPDATE courses SET ${updates.join(', ')} WHERE id=$${p}`, params);
    }
    success(res, { updated: true, thumbnail_url: thumbnailUrl });
  } catch (err) { next(err); }
});

// DELETE /education/courses/:id — Admin: delete course
router.delete('/courses/:id', authenticate, requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    await query('DELETE FROM courses WHERE id=$1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// LECTURES
// ══════════════════════════════════════════════════════════════════════════════

// POST /education/lectures — Admin: add lecture to course
router.post('/lectures', authenticate, requireRole('super_admin', 'state_admin', 'staff'),
  upload.fields([{ name: 'thumbnail', maxCount: 1 }, { name: 'video', maxCount: 1 }]), async (req, res, next) => {
  try {
    const { courseId, title, description, videoType, videoUrl, duration, sortOrder } = req.body;
    if (!courseId || !title) return res.status(400).json({ success: false, message: 'Course ID and title required' });

    let thumbnailUrl: string | null = null;
    let finalVideoUrl: string | null = videoUrl || null;

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

    // Upload thumbnail to CDN
    if (files?.thumbnail?.[0]) {
      thumbnailUrl = await uploadToR2(files.thumbnail[0].buffer, files.thumbnail[0].originalname, 'education/thumbnails', files.thumbnail[0].mimetype);
    } else if (req.body.thumbnailBase64) {
      thumbnailUrl = await uploadBase64ToR2(req.body.thumbnailBase64, 'education/thumbnails');
    }

    // Upload video to CDN (if direct upload, not YouTube/Meet link)
    if (files?.video?.[0] && videoType === 'upload') {
      finalVideoUrl = await uploadToR2(files.video[0].buffer, files.video[0].originalname, 'education/videos', files.video[0].mimetype);
    }

    const id = uuidv4();
    await query(
      `INSERT INTO lectures (id, course_id, title, description, thumbnail_url, video_type, video_url, duration, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, courseId, title, description || null, thumbnailUrl, videoType || 'youtube', finalVideoUrl, duration || null, parseInt(sortOrder) || 0]
    );

    // Update course lecture count
    await query('UPDATE courses SET total_lectures=(SELECT COUNT(*) FROM lectures WHERE course_id=$1 AND is_active=true) WHERE id=$1', [courseId]);

    logger.info(`[Education] Lecture added: ${title} to course ${courseId}`);
    success(res, { id, title, video_type: videoType, video_url: finalVideoUrl, thumbnail_url: thumbnailUrl }, 201);
  } catch (err) { next(err); }
});

// PUT /education/lectures/:id — Admin: update lecture
router.put('/lectures/:id', authenticate, requireRole('super_admin', 'state_admin', 'staff'), async (req, res, next) => {
  try {
    const { title, description, videoType, videoUrl, duration, sortOrder, isActive } = req.body;
    const updates: string[] = []; const params: any[] = []; let p = 1;

    if (title !== undefined) { updates.push(`title=$${p++}`); params.push(title); }
    if (description !== undefined) { updates.push(`description=$${p++}`); params.push(description); }
    if (videoType !== undefined) { updates.push(`video_type=$${p++}`); params.push(videoType); }
    if (videoUrl !== undefined) { updates.push(`video_url=$${p++}`); params.push(videoUrl); }
    if (duration !== undefined) { updates.push(`duration=$${p++}`); params.push(duration); }
    if (sortOrder !== undefined) { updates.push(`sort_order=$${p++}`); params.push(parseInt(sortOrder)); }
    if (isActive !== undefined) { updates.push(`is_active=$${p++}`); params.push(isActive); }

    if (updates.length > 0) {
      params.push(req.params.id);
      await query(`UPDATE lectures SET ${updates.join(', ')} WHERE id=$${p}`, params);
    }
    success(res, { updated: true });
  } catch (err) { next(err); }
});

// DELETE /education/lectures/:id — Admin: delete lecture
router.delete('/lectures/:id', authenticate, requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const lecture = await queryOne<{ course_id: string }>('SELECT course_id FROM lectures WHERE id=$1', [req.params.id]);
    await query('DELETE FROM lectures WHERE id=$1', [req.params.id]);
    if (lecture) {
      await query('UPDATE courses SET total_lectures=(SELECT COUNT(*) FROM lectures WHERE course_id=$1 AND is_active=true) WHERE id=$1', [lecture.course_id]);
    }
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// ENROLLMENT (kept from before)
// ══════════════════════════════════════════════════════════════════════════════

// GET /education/settings
router.get('/settings', async (_req, res, next) => {
  try {
    if (isFallback()) return success(res, (memStore as any).educationSettings);
    const row = await queryOne<{ form_enabled: boolean; courses: any }>(`SELECT form_enabled, courses FROM education_settings WHERE id=1`);
    if (row) {
      let courses: any[] = [];
      try { courses = typeof row.courses === 'string' ? JSON.parse(row.courses) : (row.courses ?? []); } catch (_) {}
      return success(res, { formEnabled: row.form_enabled, courses });
    }
    await query(`INSERT INTO education_settings (id, form_enabled, courses) VALUES (1, true, '[]') ON CONFLICT DO NOTHING`);
    success(res, { formEnabled: true, courses: [] });
  } catch (err) { next(err); }
});

// PUT /education/settings
router.put('/settings', authenticate, requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const { formEnabled, courses } = req.body;
    if (isFallback()) {
      if (formEnabled !== undefined) (memStore as any).educationSettings.formEnabled = formEnabled;
      return success(res, (memStore as any).educationSettings);
    }
    const updates: string[] = []; const params: unknown[] = []; let p = 1;
    if (formEnabled !== undefined) { updates.push(`form_enabled=$${p++}`); params.push(formEnabled); }
    if (courses !== undefined) { updates.push(`courses=$${p++}`); params.push(JSON.stringify(courses)); }
    if (updates.length > 0) await query(`UPDATE education_settings SET ${updates.join(', ')} WHERE id=1`, params);
    success(res, { formEnabled, courses });
  } catch (err) { next(err); }
});

// GET /education/my-enrollment
router.get('/my-enrollment', authenticate, async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    if (isFallback()) {
      const item = ((memStore as any).educationForms as any[]).find((f: any) => f.userId === userId);
      return success(res, { enrolled: !!item, data: item || null });
    }
    const row = await queryOne(`SELECT * FROM education_enrollments WHERE user_id=$1`, [userId]);
    success(res, { enrolled: !!row, data: row || null });
  } catch (err) { next(err); }
});

// POST /education/enroll
router.post('/enroll', authenticate, async (req, res, next) => {
  try {
    const { name, dob, photo, interest } = req.body;
    const userId = req.user!.userId;
    if (!name || !interest) return res.status(400).json({ success: false, message: 'Name and interest are required' });

    if (!isFallback()) {
      const existing = await queryOne<{ id: string }>('SELECT id FROM education_enrollments WHERE user_id=$1', [userId]);
      if (existing) return res.status(409).json({ success: false, message: 'You have already submitted an enrollment form.' });
    }

    let photoUrl: string | null = null;
    if (photo && photo.startsWith('data:')) {
      try {
        const uploaded = await uploadBase64ToR2(photo, 'education');
        photoUrl = uploaded || photo;
      } catch (_) { photoUrl = photo; }
    } else if (photo) { photoUrl = photo; }

    const id = uuidv4();
    await query(
      `INSERT INTO education_enrollments (id, user_id, name, dob, photo_url, interest, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [id, userId, name, dob || null, photoUrl, interest]
    );
    success(res, { id, message: 'Enrollment submitted successfully!' }, 201);
  } catch (err) { next(err); }
});

// GET /education/enrollments — Admin
router.get('/enrollments', authenticate, requireRole('super_admin', 'state_admin', 'staff'), async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;
    const [rows, countRow] = await Promise.all([
      query(`SELECT * FROM education_enrollments ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM education_enrollments`),
    ]);
    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

// DELETE /education/enrollments/:id — Admin
router.delete('/enrollments/:id', authenticate, requireRole('super_admin', 'state_admin', 'staff'), async (req, res, next) => {
  try {
    await query('DELETE FROM education_enrollments WHERE id=$1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

export default router;
