import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { success } from '../../shared/response.js';
import { eventService } from './event.service.js';
import { AppError } from '../../shared/AppError.js';
import { qs, qi, str } from '../../shared/queryHelper.js';

const createEventSchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(10),
  venue: z.string().min(5).max(200),
  address: z.string().optional(),
  district: z.string(),
  state: z.string(),
  category: z.string().min(1),
  type: z.enum(['free', 'paid', 'members_only', 'invitation_only']).default('free'),
  maxCapacity: z.number().int().min(1).optional(),
  registrationRequired: z.boolean().default(false),
  imageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().optional(),
  tags: z.array(z.string()).optional(),
  startsAt: z.string(),
  endsAt: z.string().optional(),
  registrationDeadline: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const updateEventSchema = createEventSchema.partial();

const registerEventSchema = z.object({
  name: z.string().min(2),
  mobile: z.string().regex(/^\d{10}$/),
  email: z.string().email().optional(),
  familyMembersCount: z.number().int().min(1).max(10).default(1),
});

export const eventController = {
  async getEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await eventService.getEvents({
        page: qi(req.query.page, 1),
        limit: qi(req.query.limit, 10),
        search: qs(req.query.search),
        category: qs(req.query.category),
        district: qs(req.query.district),
        state: qs(req.query.state),
        type: qs(req.query.type),
        upcoming: req.query.upcoming === 'true',
      });
      success(res, result);
    } catch (err) { next(err); }
  },

  async getEventById(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await eventService.getEventById(str(req.params.id));
      if (!event) throw AppError.notFound('Event not found');
      success(res, event);
    } catch (err) { next(err); }
  },

  async registerForEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const data = registerEventSchema.parse(req.body);
      const registration = await eventService.registerForEvent(str(req.params.id), {
        name: data.name as string,
        mobile: data.mobile as string,
        email: data.email,
        familyMembersCount: data.familyMembersCount,
        userId: req.user?.userId ?? null,
      });
      success(res, registration, 201);
    } catch (err) { next(err); }
  },

  async createEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createEventSchema.parse(req.body);
      const event = await eventService.createEvent({
        title: data.title as string,
        description: data.description as string,
        venue: data.venue as string,
        address: data.address,
        district: data.district as string,
        state: data.state as string,
        category: data.category as string,
        type: data.type,
        maxCapacity: data.maxCapacity,
        registrationRequired: data.registrationRequired,
        imageUrl: data.imageUrl,
        videoUrl: data.videoUrl,
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        contactEmail: data.contactEmail,
        tags: data.tags,
        startsAt: data.startsAt as string,
        endsAt: data.endsAt,
        registrationDeadline: data.registrationDeadline,
        latitude: data.latitude,
        longitude: data.longitude,
        organizerId: str(req.user!.userId),
      });
      success(res, event, 201);
    } catch (err) { next(err); }
  },

  async updateEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateEventSchema.parse(req.body);
      const event = await eventService.updateEvent(str(req.params.id), data);
      if (!event) throw AppError.notFound('Event not found');
      success(res, event);
    } catch (err) { next(err); }
  },

  async deleteEvent(req: Request, res: Response, next: NextFunction) {
    try {
      await eventService.deleteEvent(str(req.params.id));
      success(res, { message: 'Event deleted successfully' });
    } catch (err) { next(err); }
  },

  async toggleActive(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await eventService.toggleActive(str(req.params.id), req.body.isActive);
      success(res, event);
    } catch (err) { next(err); }
  },

  async getAdminEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await eventService.getAdminEvents({
        page: qi(req.query.page, 1),
        limit: qi(req.query.limit, 20),
        status: qs(req.query.status),
      });
      success(res, result);
    } catch (err) { next(err); }
  },

  async getEventRegistrations(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await eventService.getEventRegistrations(
        str(req.params.id),
        qi(req.query.page, 1),
        qi(req.query.limit, 20),
      );
      success(res, result);
    } catch (err) { next(err); }
  },

  async getNearbyEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const lat = parseFloat(qs(req.query.lat) ?? 'NaN');
      const lng = parseFloat(qs(req.query.lng) ?? 'NaN');
      if (isNaN(lat) || isNaN(lng)) throw AppError.badRequest('lat and lng are required');
      const radius = qi(req.query.radius, 50);
      const events = await eventService.getNearbyEvents(lat, lng, radius);
      success(res, events);
    } catch (err) { next(err); }
  },

  async getCalendarEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const startDate = qs(req.query.start);
      const endDate = qs(req.query.end);
      if (!startDate || !endDate) throw AppError.badRequest('start and end dates are required');
      const events = await eventService.getCalendarEvents(startDate, endDate);
      success(res, events);
    } catch (err) { next(err); }
  },
};
