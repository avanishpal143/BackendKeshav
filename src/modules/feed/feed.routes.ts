import { Router } from 'express';
import { success } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { query } from '../../infrastructure/database/postgres.js';
import { logger } from '../../shared/logger.js';

const router = Router();

// GET / — public home feed: ONLY items marked featured_on_home by admin
router.get('/', async (_req, res, next) => {
  try {
    if (isFallback()) {
      // In memory mode, show items marked with featured_on_home
      const news = memStore.news
        .filter(n => n.published && (n as any).featured_on_home === true)
        .map(n => ({ type: 'news' as const, id: n.id, title: n.title, summary: n.summary, category: n.category, image_url: n.image_url, created_at: n.created_at }));

      const events = memStore.events
        .filter(e => e.is_active && (e as any).featured_on_home === true)
        .map(e => ({ type: 'event' as const, id: e.id, title: e.title, summary: `${e.venue}`, category: e.category || 'Event', image_url: e.image_url, created_at: e.created_at }));

      const surveys = memStore.surveys
        .filter(s => s.is_active && (s as any).featured_on_home === true)
        .map(s => ({ type: 'survey' as const, id: s.id, title: s.title, summary: s.description, category: s.category, image_url: null, created_at: s.created_at }));

      const feed = [...news, ...events, ...surveys]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      return success(res, feed);
    }

    // Postgres: only get items where admin marked featured_on_home = true
    try {
      const [newsRows, eventRows, surveyRows] = await Promise.all([
        query(`
          SELECT 'news' as type, id, title, summary, category, image_url, created_at
          FROM news WHERE published = true AND featured_on_home = true
          ORDER BY created_at DESC LIMIT 5
        `),
        query(`
          SELECT 'event' as type, id, title, venue as summary,
                 COALESCE(category, 'Event') as category, image_url, created_at
          FROM events WHERE is_active = true AND featured_on_home = true
          ORDER BY starts_at ASC LIMIT 3
        `),
        query(`
          SELECT 'survey' as type, id, title, description as summary,
                 category, NULL as image_url, created_at
          FROM surveys WHERE is_active = true AND featured_on_home = true
          ORDER BY created_at DESC LIMIT 2
        `),
      ]);

      const feed = [...newsRows, ...eventRows, ...surveyRows]
        .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      success(res, feed);
    } catch (dbErr: any) {
      // If featured_on_home column doesn't exist yet, return empty
      if (dbErr?.code === '42703') {
        logger.warn('Feed: featured_on_home column not found — run migration-featured.sql');
        return success(res, []);
      }
      throw dbErr;
    }
  } catch (err) { next(err); }
});

export default router;
