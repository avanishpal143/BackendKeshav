import { Request, Response, NextFunction } from 'express';
import { userRepository } from './user.repository.js';
import { success, paginated } from '../../shared/response.js';

export const userController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const { district, search, role } = req.query as Record<string, string>;
      const { rows, total } = await userRepository.findAll({ page, limit, district, search, role });
      paginated(res, rows, total, page, limit);
    } catch (err) { next(err); }
  },

  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userRepository.findById(String(req.params.id));
      success(res, user);
    } catch (err) { next(err); }
  },

  async getMe(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await userRepository.findById(req.user!.userId);
      success(res, user);
    } catch (err) { next(err); }
  },

  async updateMe(req: Request, res: Response, next: NextFunction) {
    try {
      const allowed = ['name', 'avatar_url', 'district', 'state', 'village', 'address', 'blood_group', 'fcm_token'];
      const data: Record<string, unknown> = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) data[key] = req.body[key];
      }
      await userRepository.update(req.user!.userId, data);
      const updated = await userRepository.findById(req.user!.userId);
      success(res, updated);
    } catch (err) { next(err); }
  },

  async toggleActive(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await userRepository.toggleActive(String(req.params.id));
      success(res, result);
    } catch (err) { next(err); }
  },

  async stats(_req: Request, res: Response, next: NextFunction) {
    try {
      const rows = await userRepository.getStats();
      success(res, rows);
    } catch (err) { next(err); }
  },
};
