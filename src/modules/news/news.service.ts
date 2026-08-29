import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { isFallback } from '../../shared/dbHelper.js';
import { logger } from '../../shared/logger.js';

interface NewsData {
  title: string;
  summary: string;
  body: string;
  category: string;
  tags?: string[];
  imageUrl?: string;
  videoUrl?: string;
  district?: string;
  state?: string;
  priority?: string;
  publishedAt?: string;
  expiresAt?: string;
  authorId: string;
}

export const newsService = {
  async getNews(filters: {
    page: number;
    limit: number;
    search?: string;
    category?: string;
    district?: string;
    state?: string;
    priority?: string;
  }) {
    const { page, limit, search, category, district, state, priority } = filters;
    const offset = (page - 1) * limit;

    if (isFallback()) {
      let news = [...memStore.news].filter(n => n.published);
      
      // Apply filters
      if (search) {
        const searchLower = search.toLowerCase();
        news = news.filter(n => 
          n.title.toLowerCase().includes(searchLower) ||
          n.summary.toLowerCase().includes(searchLower)
        );
      }
      if (category) news = news.filter(n => n.category === category);
      if (district) news = news.filter(n => n.district === district);
      if (state) news = news.filter(n => n.state === state);

      // Sort by created_at desc
      news.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const total = news.length;
      const data = news.slice(offset, offset + limit);

      return {
        data,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      };
    }

    // Database implementation
    const conditions: string[] = ['published = true'];
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(title ILIKE $${paramIndex} OR summary ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (category) {
      conditions.push(`category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }
    if (district) {
      conditions.push(`district = $${paramIndex}`);
      params.push(district);
      paramIndex++;
    }
    if (state) {
      conditions.push(`state = $${paramIndex}`);
      params.push(state);
      paramIndex++;
    }
    if (priority) {
      conditions.push(`priority = $${paramIndex}`);
      params.push(priority);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // Get total count
    const countQuery = `SELECT COUNT(*) as count FROM news ${whereClause}`;
    const totalResult = await queryOne<{ count: string }>(countQuery, params);
    const total = parseInt(totalResult?.count || '0');

    // Get news with pagination
    const newsQuery = `
      SELECT n.*, u.name as author_name 
      FROM news n 
      LEFT JOIN users u ON n.author_id = u.id 
      ${whereClause}
      ORDER BY n.created_at DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const data = await query(newsQuery, params);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  },

  async getNewsById(id: string) {
    if (isFallback()) {
      return memStore.news.find(n => n.id === id && n.published) || null;
    }

    const newsQuery = `
      SELECT n.*, u.name as author_name 
      FROM news n 
      LEFT JOIN users u ON n.author_id = u.id 
      WHERE n.id = $1 AND n.published = true
    `;
    const result = await queryOne(newsQuery, [id]);
    return result || null;
  },

  async createNews(data: NewsData) {
    const id = uuidv4();
    const now = new Date().toISOString();

    if (isFallback()) {
      const news = {
        id,
        title: data.title,
        summary: data.summary,
        body: data.body,
        category: data.category,
        image_url: data.imageUrl || null,
        video_url: data.videoUrl || null,
        district: data.district || null,
        state: data.state || null,
        priority: data.priority || 'medium',
        published: false,
        author_id: data.authorId,
        tags: data.tags?.join(',') || null,
        view_count: 0,
        published_at: data.publishedAt || null,
        expires_at: data.expiresAt || null,
        created_at: now,
        updated_at: now,
      };
      
      memStore.news.push(news);
      return news;
    }

    // Database implementation
    const insertQuery = `
      INSERT INTO news (
        id, title, summary, body, category, image_url, video_url,
        district, state, priority, author_id, tags, published_at, expires_at,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      ) RETURNING *
    `;

    const result = await queryOne(insertQuery, [
      id, data.title, data.summary, data.body, data.category,
      data.imageUrl || null, data.videoUrl || null,
      data.district || null, data.state || null, data.priority || 'medium',
      data.authorId, data.tags?.join(',') || null,
      data.publishedAt || null, data.expiresAt || null,
      now, now
    ]);

    return result;
  },

  async updateNews(id: string, data: Partial<NewsData>) {
    const now = new Date().toISOString();

    if (isFallback()) {
      const index = memStore.news.findIndex(n => n.id === id);
      if (index === -1) return null;

      const news = memStore.news[index];
      memStore.news[index] = {
        ...news,
        title: data.title ?? news.title,
        summary: data.summary ?? news.summary,
        body: data.body ?? news.body,
        category: data.category ?? news.category,
        district: data.district ?? news.district,
        state: data.state ?? news.state,
        image_url: data.imageUrl ?? news.image_url,
        priority: data.priority ?? news.priority,
        tags: Array.isArray(data.tags) ? data.tags.join(',') : (data.tags ?? news.tags),
        updated_at: now,
      };

      return memStore.news[index];
    }

    // Build update query dynamically
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        const dbKey = key === 'imageUrl' ? 'image_url' : 
                     key === 'videoUrl' ? 'video_url' : 
                     key === 'authorId' ? 'author_id' : 
                     key === 'publishedAt' ? 'published_at' : 
                     key === 'expiresAt' ? 'expires_at' : key;
        
        updates.push(`${dbKey} = $${paramIndex}`);
        params.push(Array.isArray(value) ? value.join(',') : value);
        paramIndex++;
      }
    });

    if (updates.length === 0) return null;

    updates.push(`updated_at = $${paramIndex}`);
    params.push(now);
    params.push(id);

    const updateQuery = `
      UPDATE news SET ${updates.join(', ')} 
      WHERE id = $${paramIndex + 1} 
      RETURNING *
    `;

    const result = await queryOne(updateQuery, params);
    return result;
  },

  async deleteNews(id: string) {
    if (isFallback()) {
      const index = memStore.news.findIndex(n => n.id === id);
      if (index !== -1) {
        memStore.news.splice(index, 1);
      }
      return;
    }

    await query('DELETE FROM news WHERE id = $1', [id]);
  },

  async togglePublish(id: string, published: boolean) {
    const now = new Date().toISOString();

    if (isFallback()) {
      const index = memStore.news.findIndex(n => n.id === id);
      if (index === -1) return null;

      memStore.news[index] = {
        ...memStore.news[index],
        published,
        published_at: published ? now : null,
        updated_at: now,
      };

      return memStore.news[index];
    }

    const updateQuery = `
      UPDATE news 
      SET published = $1, published_at = $2, updated_at = $3 
      WHERE id = $4 
      RETURNING *
    `;

    const result = await queryOne(updateQuery, [published, published ? now : null, now, id]);
    return result;
  },

  async getAdminNews(filters: { page: number; limit: number; status?: string }) {
    const { page, limit, status } = filters;
    const offset = (page - 1) * limit;

    if (isFallback()) {
      let news = [...memStore.news];
      
      if (status === 'published') news = news.filter(n => n.published);
      if (status === 'draft') news = news.filter(n => !n.published);

      news.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const total = news.length;
      const data = news.slice(offset, offset + limit);

      return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
    }

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (status === 'published') {
      conditions.push('published = true');
    } else if (status === 'draft') {
      conditions.push('published = false');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const countQuery = `SELECT COUNT(*) as count FROM news ${whereClause}`;
    const totalResult = await queryOne<{ count: string }>(countQuery, params);
    const total = parseInt(totalResult?.count || '0');

    const newsQuery = `
      SELECT n.*, u.name as author_name 
      FROM news n 
      LEFT JOIN users u ON n.author_id = u.id 
      ${whereClause}
      ORDER BY n.created_at DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const data = await query(newsQuery, params);

    return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
  },

  async incrementViews(id: string) {
    if (isFallback()) {
      const news = memStore.news.find(n => n.id === id);
      if (news) news.view_count = (news.view_count || 0) + 1;
      return;
    }

    await query('UPDATE news SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1', [id]);
  },

  async getTrendingNews(limit: number) {
    if (isFallback()) {
      return memStore.news
        .filter(n => n.published)
        .sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
        .slice(0, limit);
    }

    const query_text = `
      SELECT n.*, u.name as author_name 
      FROM news n 
      LEFT JOIN users u ON n.author_id = u.id 
      WHERE n.published = true 
      ORDER BY n.view_count DESC NULLS LAST, n.created_at DESC 
      LIMIT $1
    `;

    return await query(query_text, [limit]);
  },

  async bulkDelete(ids: string[]) {
    if (isFallback()) {
      ids.forEach(id => {
        const index = memStore.news.findIndex(n => n.id === id);
        if (index !== -1) memStore.news.splice(index, 1);
      });
      return;
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    await query(`DELETE FROM news WHERE id IN (${placeholders})`, ids);
  },
};