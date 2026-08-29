import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { success } from '../../shared/response.js';
import { surveyService } from './survey.service.js';
import { AppError } from '../../shared/AppError.js';
import { qs, qi } from '../../shared/queryHelper.js';

const id = (req: Request) => String(req.params.id);

const questionSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['text', 'textarea', 'radio', 'checkbox', 'rating', 'date', 'number']),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
  minRating: z.number().optional(),
  maxRating: z.number().optional(),
  order: z.number().int().min(1),
});

const createSurveySchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(5),
  category: z.string().min(1),
  targetAudience: z.enum(['all', 'members', 'district', 'state']).default('all'),
  district: z.string().optional(),
  state: z.string().optional(),
  isAnonymous: z.boolean().default(false),
  allowMultipleResponses: z.boolean().default(false),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  maxResponses: z.number().int().min(1).optional(),
  questions: z.array(questionSchema).min(1),
});

const updateSurveySchema = createSurveySchema.partial();

const submitResponseSchema = z.object({
  responses: z.array(z.object({
    questionId: z.string(),
    answer: z.union([z.string(), z.number(), z.array(z.string())]),
  })).min(1),
  respondentName: z.string().optional(),
  respondentEmail: z.string().optional(),
  respondentPhone: z.string().optional(),
});

export const surveyController = {
  async getSurveys(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await surveyService.getSurveys({
        page: qi(req.query.page, 1),
        limit: qi(req.query.limit, 10),
        category: qs(req.query.category),
        district: qs(req.query.district),
        state: qs(req.query.state),
        active: req.query.active === 'true',
      });
      success(res, result);
    } catch (err) { next(err); }
  },

  async getSurveyById(req: Request, res: Response, next: NextFunction) {
    try {
      const survey = await surveyService.getSurveyById(id(req));
      if (!survey) throw AppError.notFound('Survey not found');
      success(res, survey);
    } catch (err) { next(err); }
  },

  async submitResponse(req: Request, res: Response, next: NextFunction) {
    try {
      const data = submitResponseSchema.parse(req.body);
      const response = await surveyService.submitResponse(id(req), {
        responses: (data.responses as Array<{ questionId: string; answer: string | number | string[] }>),
        respondentName: data.respondentName,
        respondentEmail: data.respondentEmail,
        respondentPhone: data.respondentPhone,
        userId: req.user?.userId ?? null,
      });
      success(res, response, 201);
    } catch (err) { next(err); }
  },

  async createSurvey(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createSurveySchema.parse(req.body);
      const survey = await surveyService.createSurvey({
        title: data.title as string,
        description: data.description as string,
        category: data.category as string,
        targetAudience: data.targetAudience,
        district: data.district,
        state: data.state,
        isAnonymous: data.isAnonymous,
        allowMultipleResponses: data.allowMultipleResponses,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        maxResponses: data.maxResponses,
        questions: (data.questions as any[]),
        createdBy: String(req.user!.userId),
      });
      success(res, survey, 201);
    } catch (err) { next(err); }
  },

  async updateSurvey(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateSurveySchema.parse(req.body);
      const survey = await surveyService.updateSurvey(id(req), data as any);
      if (!survey) throw AppError.notFound('Survey not found');
      success(res, survey);
    } catch (err) { next(err); }
  },

  async deleteSurvey(req: Request, res: Response, next: NextFunction) {
    try {
      await surveyService.deleteSurvey(id(req));
      success(res, { message: 'Survey deleted successfully' });
    } catch (err) { next(err); }
  },

  async toggleActive(req: Request, res: Response, next: NextFunction) {
    try {
      const survey = await surveyService.toggleActive(id(req), req.body.isActive);
      success(res, survey);
    } catch (err) { next(err); }
  },

  async getAdminSurveys(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await surveyService.getAdminSurveys({
        page: qi(req.query.page, 1),
        limit: qi(req.query.limit, 20),
        status: qs(req.query.status),
      });
      success(res, result);
    } catch (err) { next(err); }
  },

  async getSurveyResponses(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await surveyService.getSurveyResponses(
        id(req),
        qi(req.query.page, 1),
        qi(req.query.limit, 20),
      );
      success(res, result);
    } catch (err) { next(err); }
  },

  async getSurveyAnalytics(req: Request, res: Response, next: NextFunction) {
    try {
      const analytics = await surveyService.getSurveyAnalytics(id(req));
      success(res, analytics);
    } catch (err) { next(err); }
  },

  async exportSurveyResponses(req: Request, res: Response, next: NextFunction) {
    try {
      const format = qs(req.query.format) ?? 'csv';
      const data = await surveyService.exportSurveyResponses(id(req), format);
      res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="survey_${id(req)}.${format}"`);
      res.send(data);
    } catch (err) { next(err); }
  },

  async bulkDelete(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) throw AppError.badRequest('Invalid survey IDs');
      await surveyService.bulkDelete(ids);
      success(res, { message: `${ids.length} surveys deleted` });
    } catch (err) { next(err); }
  },
};
