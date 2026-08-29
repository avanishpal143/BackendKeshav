import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { uploadToR2, uploadBase64ToR2, deleteFromR2 } from '../../infrastructure/storage/r2.js';
import { sendPushToDevices } from '../../infrastructure/push/firebase.js';
import { logger } from '../../shared/logger.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

// In-memory posts store for fallback
interface MemPost {
  id: string;
  caption: string;
  media_url: string | null;
  media_type: 'image' | 'video' | 'none';
  video_url: string | null;
  category: string;
  is_published: boolean;
  likes_count: number;
  shares_count: number;
  views_count: number;
  author_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
}

if (!(memStore as any).posts) (memStore as any).posts = [] as MemPost[];

// ══════════════════════════════════════════════════════════════════════════════
// GET /posts — Public feed (paginated, published only)
// ══════════════════════════════════════════════════════════════════════════════
router.get('/', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;

    if (isFallback()) {
      const posts = ((memStore as any).posts as MemPost[])
        .filter(p => p.is_published)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return paginated(res, posts.slice(offset, offset + limit), posts.length, page, limit);
    }

    const [rows, countRow] = await Promise.all([
      query(
        `SELECT p.id, p.caption, p.media_url, p.media_type, p.video_url, p.category, p.is_published, p.likes_count, p.shares_count, p.views_count, p.created_at, p.updated_at,
               u.name as author_name, CASE WHEN u.avatar_url LIKE 'http%' THEN u.avatar_url ELSE NULL END as author_avatar
         FROM posts p LEFT JOIN users u ON p.author_id = u.id
         WHERE p.is_published = true
         ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM posts WHERE is_published = true`),
    ]);

    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /posts/admin — Admin list (all posts including drafts)
// ══════════════════════════════════════════════════════════════════════════════
router.get('/admin', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;

    if (isFallback()) {
      const posts = ((memStore as any).posts as MemPost[])
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      return paginated(res, posts.slice(offset, offset + limit), posts.length, page, limit);
    }

    const [rows, countRow] = await Promise.all([
      query(
        `SELECT p.*, u.name as author_name, u.avatar_url as author_avatar
         FROM posts p LEFT JOIN users u ON p.author_id = u.id
         ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM posts`),
    ]);

    paginated(res, rows, parseInt(countRow?.count ?? '0', 10), page, limit);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /posts — Admin creates a post (with media upload to R2)
// ══════════════════════════════════════════════════════════════════════════════
router.post('/', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'),
  upload.single('media'), async (req, res, next) => {
  try {
    const { caption, category, videoUrl, publish } = req.body;
    const id = uuidv4();
    const now = new Date().toISOString();
    const authorId = req.user!.userId;
    let mediaUrl: string | null = null;
    let mediaType: 'image' | 'video' | 'none' = 'none';

    // Handle file upload (image/video)
    if (req.file) {
      const uploaded = await uploadToR2(
        req.file.buffer,
        req.file.originalname,
        'posts',
        req.file.mimetype,
      );
      if (uploaded) {
        mediaUrl = uploaded;
        mediaType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
      }
    }
    // Handle base64 media from body
    else if (req.body.mediaBase64) {
      const uploaded = await uploadBase64ToR2(req.body.mediaBase64, 'posts');
      if (uploaded) {
        mediaUrl = uploaded;
        mediaType = req.body.mediaBase64.startsWith('data:video') ? 'video' : 'image';
      }
    }

    // If video URL provided (YouTube/external)
    const finalVideoUrl = videoUrl || null;
    if (finalVideoUrl && !mediaUrl) {
      mediaType = 'video';
    }

    const isPublished = publish === 'true' || publish === true;

    if (isFallback()) {
      const post: MemPost = {
        id, caption: caption || '', media_url: mediaUrl, media_type: mediaType,
        video_url: finalVideoUrl, category: category || 'General',
        is_published: isPublished, likes_count: 0, shares_count: 0, views_count: 0,
        author_id: authorId, author_name: 'Admin', created_at: now, updated_at: now,
      };
      ((memStore as any).posts as MemPost[]).push(post);
      return success(res, post, 201);
    }

    const rows = await query(
      `INSERT INTO posts (id, caption, media_url, media_type, video_url, category, is_published, author_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, caption || '', mediaUrl, mediaType, finalVideoUrl, category || 'General', isPublished, authorId, now, now]
    );

    // Also create in news table for backward compatibility (community news)
    if (isPublished && caption) {
      try {
        await query(
          `INSERT INTO news (id, title, summary, body, category, image_url, video_url, published, author_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10)
           ON CONFLICT DO NOTHING`,
          [uuidv4(), (caption || '').slice(0, 100), caption, caption, category || 'General', mediaUrl, finalVideoUrl, authorId, now, now]
        );
      } catch (_) { /* ignore - backward compat only */ }
    }

    logger.info(`[Post] Created by ${authorId}: ${mediaType} | ${(caption || '').slice(0, 50)}...`);

    // Send push notification to all users when post is published
    if (isPublished) {
      try {
        const allTokens = await query<{ fcm_token: string }>('SELECT fcm_token FROM users WHERE fcm_token IS NOT NULL AND is_active = true');
        const tokens = allTokens.map(r => r.fcm_token).filter(Boolean);
        if (tokens.length > 0) {
          const notifTitle = 'Ekta Koli Jatav Vikas Foundation';
          const notifBody = (caption || 'New post from admin').slice(0, 100);
          const sent = await sendPushToDevices(tokens, notifTitle, notifBody, { type: 'post', postId: id });
          logger.info(`[Post] Push notification sent to ${sent}/${tokens.length} users`);
        }
      } catch (pushErr) {
        logger.warn(`[Post] Push notification failed: ${pushErr}`);
      }
    }

    success(res, rows[0] ?? { id, caption, media_url: mediaUrl, media_type: mediaType }, 201);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// PUT /posts/:id — Admin update post
// ══════════════════════════════════════════════════════════════════════════════
router.put('/:id', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const { caption, category, isPublished } = req.body;
    const now = new Date().toISOString();

    if (isFallback()) {
      const posts = (memStore as any).posts as MemPost[];
      const idx = posts.findIndex(p => p.id === req.params.id);
      if (idx === -1) return res.status(404).json({ success: false, message: 'Post not found' });
      if (caption !== undefined) posts[idx].caption = caption;
      if (category !== undefined) posts[idx].category = category;
      if (isPublished !== undefined) posts[idx].is_published = isPublished;
      posts[idx].updated_at = now;
      return success(res, posts[idx]);
    }

    const updates: string[] = []; const params: unknown[] = []; let p = 1;
    if (caption !== undefined) { updates.push(`caption=$${p++}`); params.push(caption); }
    if (category !== undefined) { updates.push(`category=$${p++}`); params.push(category); }
    if (isPublished !== undefined) { updates.push(`is_published=$${p++}`); params.push(isPublished); }
    updates.push(`updated_at=$${p++}`); params.push(now);
    params.push(req.params.id);

    const rows = await query(`UPDATE posts SET ${updates.join(', ')} WHERE id=$${p} RETURNING *`, params);
    success(res, rows[0] ?? null);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /posts/:id — Admin delete post (also removes media from R2)
// ══════════════════════════════════════════════════════════════════════════════
router.delete('/:id', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    if (isFallback()) {
      const posts = (memStore as any).posts as MemPost[];
      const idx = posts.findIndex(p => p.id === req.params.id);
      if (idx !== -1) {
        if (posts[idx].media_url) await deleteFromR2(posts[idx].media_url!);
        posts.splice(idx, 1);
      }
      return success(res, { deleted: true });
    }

    const existing = await queryOne<{ media_url: string | null }>(`SELECT media_url FROM posts WHERE id=$1`, [req.params.id]);
    if (existing?.media_url) await deleteFromR2(existing.media_url);
    await query('DELETE FROM posts WHERE id=$1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /posts/:id/like — Increment like count
// ══════════════════════════════════════════════════════════════════════════════
router.post('/:id/like', async (req, res, next) => {
  try {
    if (isFallback()) {
      const posts = (memStore as any).posts as MemPost[];
      const post = posts.find(p => p.id === req.params.id);
      if (post) post.likes_count++;
      return success(res, { likes: post?.likes_count ?? 0 });
    }
    await query('UPDATE posts SET likes_count = likes_count + 1 WHERE id=$1', [req.params.id]);
    const row = await queryOne<{ likes_count: number }>('SELECT likes_count FROM posts WHERE id=$1', [req.params.id]);
    success(res, { likes: row?.likes_count ?? 0 });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /posts/upload — Direct media upload endpoint (returns URL)
// ══════════════════════════════════════════════════════════════════════════════
router.post('/upload', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'),
  upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file provided' });

    const url = await uploadToR2(req.file.buffer, req.file.originalname, 'media', req.file.mimetype);
    if (!url) return res.status(500).json({ success: false, message: 'Upload failed — check R2 credentials' });

    success(res, { url, contentType: req.file.mimetype, size: req.file.size });
  } catch (err) { next(err); }
});

export default router;
