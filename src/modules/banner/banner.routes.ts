import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';

const router = Router();

// GET /active — public, returns active banners for app home
router.get('/active', async (_req, res, next) => {
  try {
    if (isFallback()) {
      const banners = memStore.banners
        .filter(b => b.is_active)
        .sort((a, b) => a.sort_order - b.sort_order);
      return success(res, banners);
    }
    const rows = await query(
      'SELECT * FROM banners WHERE is_active = true ORDER BY sort_order ASC, created_at DESC'
    );
    success(res, rows);
  } catch (err) { next(err); }
});

// GET / — admin list all banners
router.get('/', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (_req, res, next) => {
  try {
    if (isFallback()) {
      const banners = [...memStore.banners].sort((a, b) => b.created_at.localeCompare(a.created_at));
      return success(res, banners);
    }
    const rows = await query('SELECT * FROM banners ORDER BY sort_order ASC, created_at DESC');
    success(res, rows);
  } catch (err) { next(err); }
});

// POST / — admin create banner
router.post('/', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const { title, description, imageUrl, videoUrl, linkType, linkId, ctaText, sortOrder } = req.body;
    const id = uuidv4();
    const now = new Date().toISOString();

    if (isFallback()) {
      const banner = {
        id,
        title: title || '',
        description: description || '',
        image_url: imageUrl || null,
        video_url: videoUrl || null,
        link_type: linkType || null, // 'news' | 'event' | 'survey' | 'external' | null
        link_id: linkId || null,
        cta_text: ctaText || null,
        is_active: true,
        sort_order: sortOrder ?? 0,
        created_by: req.user!.userId,
        created_at: now,
      };
      memStore.banners.push(banner);
      return success(res, banner, 201);
    }

    const rows = await query(
      `INSERT INTO banners (id, title, description, image_url, video_url, link_type, link_id, cta_text, is_active, sort_order, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11) RETURNING *`,
      [id, title || '', description || '', imageUrl || null, videoUrl || null, linkType || null, linkId || null, ctaText || null, sortOrder ?? 0, req.user!.userId, now]
    );
    success(res, rows[0], 201);
  } catch (err) { next(err); }
});

// PUT /:id — admin update banner
router.put('/:id', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const { title, description, imageUrl, videoUrl, linkType, linkId, ctaText, isActive, sortOrder } = req.body;

    if (isFallback()) {
      const banner = memStore.banners.find(b => b.id === req.params.id);
      if (!banner) return res.status(404).json({ success: false, error: 'Banner not found' });
      if (title !== undefined) banner.title = title;
      if (description !== undefined) banner.description = description;
      if (imageUrl !== undefined) banner.image_url = imageUrl;
      if (videoUrl !== undefined) banner.video_url = videoUrl;
      if (linkType !== undefined) banner.link_type = linkType;
      if (linkId !== undefined) banner.link_id = linkId;
      if (ctaText !== undefined) banner.cta_text = ctaText;
      if (isActive !== undefined) banner.is_active = isActive;
      if (sortOrder !== undefined) banner.sort_order = sortOrder;
      return success(res, banner);
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    if (title !== undefined) { updates.push(`title=$${p++}`); params.push(title); }
    if (description !== undefined) { updates.push(`description=$${p++}`); params.push(description); }
    if (imageUrl !== undefined) { updates.push(`image_url=$${p++}`); params.push(imageUrl); }
    if (videoUrl !== undefined) { updates.push(`video_url=$${p++}`); params.push(videoUrl); }
    if (linkType !== undefined) { updates.push(`link_type=$${p++}`); params.push(linkType); }
    if (linkId !== undefined) { updates.push(`link_id=$${p++}`); params.push(linkId); }
    if (ctaText !== undefined) { updates.push(`cta_text=$${p++}`); params.push(ctaText); }
    if (isActive !== undefined) { updates.push(`is_active=$${p++}`); params.push(isActive); }
    if (sortOrder !== undefined) { updates.push(`sort_order=$${p++}`); params.push(sortOrder); }
    if (!updates.length) return success(res, null);

    params.push(req.params.id);
    const rows = await query(`UPDATE banners SET ${updates.join(', ')} WHERE id=$${p} RETURNING *`, params);
    success(res, rows[0] ?? null);
  } catch (err) { next(err); }
});

// DELETE /:id
router.delete('/:id', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    if (isFallback()) {
      memStore.banners = memStore.banners.filter(b => b.id !== req.params.id);
      return success(res, { deleted: true });
    }
    await query('DELETE FROM banners WHERE id=$1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

export default router;
