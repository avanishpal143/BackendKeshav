import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { success } from '../../shared/response.js';
import { newsService } from './news.service.js';
import { AppError } from '../../shared/AppError.js';
import { qs, qi } from '../../shared/queryHelper.js';

const createNewsSchema = z.object({
  title: z.string().min(5).max(200),
  summary: z.string().min(10).max(500),
  body: z.string().min(10),
  category: z.string().min(1),
  tags: z.array(z.string()).optional(),
  imageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  district: z.string().optional(),
  state: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  publishedAt: z.string().optional(),
  expiresAt: z.string().optional(),
});

const updateNewsSchema = createNewsSchema.partial();

const id = (req: Request) => String(req.params.id);

export const newsController = {
  async getNews(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await newsService.getNews({
        page: qi(req.query.page, 1),
        limit: qi(req.query.limit, 10),
        search: qs(req.query.search),
        category: qs(req.query.category),
        district: qs(req.query.district),
        state: qs(req.query.state),
        priority: qs(req.query.priority),
      });
      success(res, result);
    } catch (err) { next(err); }
  },

  async getNewsById(req: Request, res: Response, next: NextFunction) {
    try {
      const news = await newsService.getNewsById(id(req));
      if (!news) throw AppError.notFound('News article not found');
      await newsService.incrementViews(id(req));
      success(res, news);
    } catch (err) { next(err); }
  },

  async createNews(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createNewsSchema.parse(req.body);
      const news = await newsService.createNews({
        title: data.title,
        summary: data.summary,
        body: data.body,
        category: data.category,
        tags: data.tags,
        imageUrl: data.imageUrl,
        videoUrl: data.videoUrl,
        district: data.district,
        state: data.state,
        priority: data.priority,
        publishedAt: data.publishedAt,
        expiresAt: data.expiresAt,
        authorId: String(req.user!.userId),
      });
      success(res, news, 201);
    } catch (err) { next(err); }
  },

  async updateNews(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateNewsSchema.parse(req.body);
      const news = await newsService.updateNews(id(req), data);
      if (!news) throw AppError.notFound('News article not found');
      success(res, news);
    } catch (err) { next(err); }
  },

  async deleteNews(req: Request, res: Response, next: NextFunction) {
    try {
      await newsService.deleteNews(id(req));
      success(res, { message: 'News article deleted successfully' });
    } catch (err) { next(err); }
  },

  async togglePublish(req: Request, res: Response, next: NextFunction) {
    try {
      const news = await newsService.togglePublish(id(req), req.body.published);
      success(res, news);
    } catch (err) { next(err); }
  },

  async getAdminNews(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await newsService.getAdminNews({
        page: qi(req.query.page, 1),
        limit: qi(req.query.limit, 20),
        status: qs(req.query.status),
      });
      success(res, result);
    } catch (err) { next(err); }
  },

  async getTrendingNews(req: Request, res: Response, next: NextFunction) {
    try {
      const news = await newsService.getTrendingNews(qi(req.query.limit, 5));
      success(res, news);
    } catch (err) { next(err); }
  },

  async bulkDelete(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) throw AppError.badRequest('Invalid news IDs');
      await newsService.bulkDelete(ids);
      success(res, { message: `${ids.length} news articles deleted` });
    } catch (err) { next(err); }
  },
};
