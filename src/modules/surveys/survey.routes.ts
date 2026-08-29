import { Router } from 'express';
import { surveyController } from './survey.controller.js';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';

const router = Router();

// ── Admin routes — must be BEFORE /:id to avoid param conflict ───────────────
router.get('/admin/surveys', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), surveyController.getAdminSurveys);
router.post('/admin/surveys', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), surveyController.createSurvey);
router.post('/admin/surveys/bulk-delete', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), surveyController.bulkDelete);
router.get('/admin/surveys/:id/responses', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), surveyController.getSurveyResponses);
router.get('/admin/surveys/:id/analytics', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), surveyController.getSurveyAnalytics);
router.get('/admin/surveys/:id/export', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), surveyController.exportSurveyResponses);
router.put('/admin/surveys/:id', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), surveyController.updateSurvey);
router.delete('/admin/surveys/:id', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), surveyController.deleteSurvey);
router.post('/admin/surveys/:id/toggle-active', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), surveyController.toggleActive);

// ── Public routes ─────────────────────────────────────────────────────────────
router.get('/', surveyController.getSurveys);
router.get('/:id', surveyController.getSurveyById);

// ── Authenticated user routes ─────────────────────────────────────────────────
router.post('/:id/submit', authenticate, surveyController.submitResponse);

export default router;
