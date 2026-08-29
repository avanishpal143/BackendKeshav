import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { eventController } from './event.controller.js';

const router = Router();

// ── Admin routes — must be BEFORE /:id to avoid param conflict ───────────────
router.get('/admin/events', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), eventController.getAdminEvents);
router.post('/admin/events', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), eventController.createEvent);
router.get('/admin/events/:id/registrations', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), eventController.getEventRegistrations);
router.put('/admin/events/:id', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), eventController.updateEvent);
router.delete('/admin/events/:id', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), eventController.deleteEvent);
router.post('/admin/events/:id/toggle-active', authenticate, requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), eventController.toggleActive);

// ── Public routes ─────────────────────────────────────────────────────────────
router.get('/nearby', eventController.getNearbyEvents);
router.get('/calendar', eventController.getCalendarEvents);
router.get('/', eventController.getEvents);
router.get('/:id', eventController.getEventById);

// ── Authenticated user routes ─────────────────────────────────────────────────
router.post('/:id/register', authenticate, eventController.registerForEvent);

export default router;
