import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { newsController } from './news.controller.js';

const router = Router();

// ── Admin routes — must be registered BEFORE /:id to avoid param conflict ────
router.get('/admin', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), newsController.getAdminNews);
router.post('/admin', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), newsController.createNews);
router.post('/admin/bulk-delete', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), newsController.bulkDelete);
router.put('/admin/:id', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), newsController.updateNews);
router.delete('/admin/:id', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), newsController.deleteNews);
router.post('/admin/:id/publish', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), newsController.togglePublish);

// ── Public routes ─────────────────────────────────────────────────────────────
router.get('/trending', newsController.getTrendingNews);
router.get('/', newsController.getNews);
router.get('/:id', newsController.getNewsById);

export default router;
