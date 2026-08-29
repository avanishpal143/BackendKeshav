import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { isFallback } from '../../shared/dbHelper.js';
import { logger } from '../../shared/logger.js';

interface QuestionData {
  id?: string;
  type: 'text' | 'textarea' | 'radio' | 'checkbox' | 'rating' | 'date' | 'number';
  title: string;
  description?: string;
  required?: boolean;
  options?: string[];
  minRating?: number;
  maxRating?: number;
  order: number;
}

interface SurveyData {
  title: string;
  description: string;
  category: string;
  targetAudience?: string;
  district?: string;
  state?: string;
  isAnonymous?: boolean;
  allowMultipleResponses?: boolean;
  startsAt?: string;
  endsAt?: string;
  maxResponses?: number;
  questions: QuestionData[];
  createdBy: string;
}

interface ResponseData {
  responses: Array<{
    questionId: string;
    answer: string | number | string[];
  }>;
  respondentName?: string;
  respondentEmail?: string;
  respondentPhone?: string;
  userId?: string | null;
}

export const surveyService = {
  async getSurveys(filters: {
    page: number;
    limit: number;
    category?: string;
    district?: string;
    state?: string;
    active?: boolean;
  }) {
    const { page, limit, category, district, state, active } = filters;
    const offset = (page - 1) * limit;

    if (isFallback()) {
      let surveys = [...memStore.surveys].filter(s => s.is_active);
      
      // Apply filters
      if (category) surveys = surveys.filter(s => s.category === category);
      if (district) surveys = surveys.filter(s => s.district === district);
      if (state) surveys = surveys.filter(s => s.state === state);
      if (active) {
        const now = new Date();
        surveys = surveys.filter(s => {
          const startsAt = s.starts_at ? new Date(s.starts_at) : null;
          const endsAt = s.ends_at ? new Date(s.ends_at) : null;
          return (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now);
        });
      }

      surveys.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const total = surveys.length;
      const data = surveys.slice(offset, offset + limit);

      return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
    }

    const conditions: string[] = ['s.is_active = true'];
    const params: any[] = [];
    let paramIndex = 1;

    if (category) {
      conditions.push(`s.category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }
    if (district) {
      conditions.push(`s.district = $${paramIndex}`);
      params.push(district);
      paramIndex++;
    }
    if (state) {
      conditions.push(`s.state = $${paramIndex}`);
      params.push(state);
      paramIndex++;
    }
    if (active) {
      conditions.push('(s.starts_at IS NULL OR s.starts_at <= NOW())');
      conditions.push('(s.ends_at IS NULL OR s.ends_at >= NOW())');
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    
    const countQuery = `SELECT COUNT(*) as count FROM surveys s ${whereClause}`;
    const totalResult = await queryOne<{ count: string }>(countQuery, params);
    const total = parseInt(totalResult?.count || '0');

    const surveysQuery = `
      SELECT s.*, u.name as created_by_name 
      FROM surveys s 
      LEFT JOIN users u ON s.created_by = u.id 
      ${whereClause}
      ORDER BY s.created_at DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const data = await query(surveysQuery, params);
    return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
  },

  async getSurveyById(id: string) {
    if (isFallback()) {
      const survey = memStore.surveys.find(s => s.id === id && s.is_active);
      if (!survey) return null;
      
      // Add questions from memory store
      const questions = memStore.survey_questions.filter(q => q.survey_id === id)
        .sort((a, b) => a.order - b.order);
      
      return { ...survey, questions };
    }

    const surveyQuery = `
      SELECT s.*, u.name as created_by_name 
      FROM surveys s 
      LEFT JOIN users u ON s.created_by = u.id 
      WHERE s.id = $1 AND s.is_active = true
    `;
    
    const survey = await queryOne(surveyQuery, [id]);
    if (!survey) return null;

    const questionsQuery = `
      SELECT * FROM survey_questions 
      WHERE survey_id = $1 
      ORDER BY question_order ASC
    `;
    
    const questions = await query(questionsQuery, [id]);
    return { ...survey, questions };
  },

  async createSurvey(data: SurveyData) {
    const surveyId = uuidv4();
    const now = new Date().toISOString();

    if (isFallback()) {
      const survey = {
        id: surveyId,
        title: data.title,
        description: data.description,
        category: data.category,
        target_audience: data.targetAudience || 'all',
        district: data.district || null,
        state: data.state || null,
        is_anonymous: data.isAnonymous || false,
        allow_multiple_responses: data.allowMultipleResponses || false,
        starts_at: data.startsAt || null,
        ends_at: data.endsAt || null,
        max_responses: data.maxResponses || null,
        created_by: data.createdBy,
        is_active: true,
        response_count: 0,
        created_at: now,
        updated_at: now,
      };
      
      memStore.surveys.push(survey);

      // Add questions to memory store
      data.questions.forEach(questionData => {
        const questionId = uuidv4();
        const question = {
          id: questionId,
          survey_id: surveyId,
          type: questionData.type,
          title: questionData.title,
          description: questionData.description || null,
          required: questionData.required || false,
          options: questionData.options?.join(',') || null,
          min_rating: questionData.minRating || null,
          max_rating: questionData.maxRating || null,
          order: questionData.order,
        };
        memStore.survey_questions.push(question);
      });

      return survey;
    }

    // Database implementation
    const insertSurveyQuery = `
      INSERT INTO surveys (
        id, title, description, category, target_audience, district, state,
        is_anonymous, allow_multiple_responses, starts_at, ends_at, max_responses,
        created_by, is_active, response_count, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      ) RETURNING *
    `;

    const survey = await queryOne(insertSurveyQuery, [
      surveyId, data.title, data.description, data.category,
      data.targetAudience || 'all', data.district, data.state,
      data.isAnonymous || false, data.allowMultipleResponses || false,
      data.startsAt, data.endsAt, data.maxResponses,
      data.createdBy, true, 0, now, now
    ]);

    // Insert questions
    for (const questionData of data.questions) {
      const questionId = uuidv4();
      const insertQuestionQuery = `
        INSERT INTO survey_questions (
          id, survey_id, question_type, title, description, required, 
          options, min_rating, max_rating, question_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `;

      await query(insertQuestionQuery, [
        questionId, surveyId, questionData.type, questionData.title,
        questionData.description, questionData.required || false,
        questionData.options?.join(','), questionData.minRating,
        questionData.maxRating, questionData.order
      ]);
    }

    return survey;
  },

  async submitResponse(surveyId: string, data: ResponseData) {
    const responseId = uuidv4();
    const now = new Date().toISOString();

    if (isFallback()) {
      // Store response in memory
      const response = {
        id: responseId,
        survey_id: surveyId,
        user_id: data.userId ?? null,
        respondent_name: data.respondentName || null,
        respondent_email: data.respondentEmail || null,
        respondent_phone: data.respondentPhone || null,
        submitted_at: now,
      };
      
      memStore.survey_responses.push(response);

      // Store individual answers
      data.responses.forEach(answer => {
        const answerData = {
          id: uuidv4(),
          response_id: responseId,
          question_id: answer.questionId,
          answer_text: typeof answer.answer === 'string' ? answer.answer : null,
          answer_number: typeof answer.answer === 'number' ? answer.answer : null,
          answer_array: Array.isArray(answer.answer) ? answer.answer.join(',') : null,
        };
        memStore.survey_answers.push(answerData);
      });

      // Update response count
      const survey = memStore.surveys.find(s => s.id === surveyId);
      if (survey) survey.response_count++;

      return response;
    }

    // Database implementation
    const insertResponseQuery = `
      INSERT INTO survey_responses (
        id, survey_id, user_id, respondent_name, respondent_email, 
        respondent_phone, submitted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING *
    `;

    const response = await queryOne(insertResponseQuery, [
      responseId, surveyId, data.userId, data.respondentName,
      data.respondentEmail, data.respondentPhone, now
    ]);

    // Insert answers
    for (const answer of data.responses) {
      const answerId = uuidv4();
      const insertAnswerQuery = `
        INSERT INTO survey_answers (
          id, response_id, question_id, answer_text, answer_number, answer_array
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `;

      await query(insertAnswerQuery, [
        answerId, responseId, answer.questionId,
        typeof answer.answer === 'string' ? answer.answer : null,
        typeof answer.answer === 'number' ? answer.answer : null,
        Array.isArray(answer.answer) ? answer.answer.join(',') : null
      ]);
    }

    // Update response count
    await query('UPDATE surveys SET response_count = response_count + 1 WHERE id = $1', [surveyId]);

    return response;
  },

  async updateSurvey(id: string, data: Partial<SurveyData>) {
    const now = new Date().toISOString();

    if (isFallback()) {
      const index = memStore.surveys.findIndex(s => s.id === id);
      if (index === -1) return null;

      const survey = memStore.surveys[index];
      memStore.surveys[index] = { ...survey, ...data, updated_at: now };
      return memStore.surveys[index];
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined && key !== 'questions') {
        const dbKey = key === 'targetAudience' ? 'target_audience' :
                     key === 'isAnonymous' ? 'is_anonymous' :
                     key === 'allowMultipleResponses' ? 'allow_multiple_responses' :
                     key === 'startsAt' ? 'starts_at' :
                     key === 'endsAt' ? 'ends_at' :
                     key === 'maxResponses' ? 'max_responses' :
                     key === 'createdBy' ? 'created_by' : key;
        
        updates.push(`${dbKey} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    });

    if (updates.length === 0) return null;

    updates.push(`updated_at = $${paramIndex}`);
    params.push(now);
    params.push(id);

    const updateQuery = `UPDATE surveys SET ${updates.join(', ')} WHERE id = $${paramIndex + 1} RETURNING *`;
    return await queryOne(updateQuery, params);
  },

  async deleteSurvey(id: string) {
    if (isFallback()) {
      const index = memStore.surveys.findIndex(s => s.id === id);
      if (index !== -1) memStore.surveys.splice(index, 1);
      
      // Remove related questions and responses
      memStore.survey_questions = memStore.survey_questions.filter(q => q.survey_id !== id);
      const responseIds = memStore.survey_responses.filter(r => r.survey_id === id).map(r => r.id);
      memStore.survey_responses = memStore.survey_responses.filter(r => r.survey_id !== id);
      memStore.survey_answers = memStore.survey_answers.filter(a => !responseIds.includes(a.response_id));
      return;
    }

    await query('DELETE FROM surveys WHERE id = $1', [id]);
  },

  async toggleActive(id: string, isActive: boolean) {
    const now = new Date().toISOString();

    if (isFallback()) {
      const index = memStore.surveys.findIndex(s => s.id === id);
      if (index === -1) return null;

      memStore.surveys[index] = { ...memStore.surveys[index], is_active: isActive, updated_at: now };
      return memStore.surveys[index];
    }

    const updateQuery = `UPDATE surveys SET is_active = $1, updated_at = $2 WHERE id = $3 RETURNING *`;
    return await queryOne(updateQuery, [isActive, now, id]);
  },

  async getAdminSurveys(filters: { page: number; limit: number; status?: string }) {
    const { page, limit, status } = filters;
    const offset = (page - 1) * limit;

    if (isFallback()) {
      let surveys = [...memStore.surveys];
      
      if (status === 'active') surveys = surveys.filter(s => s.is_active);
      if (status === 'inactive') surveys = surveys.filter(s => !s.is_active);

      surveys.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const total = surveys.length;
      const data = surveys.slice(offset, offset + limit);

      return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
    }

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (status === 'active') conditions.push('is_active = true');
    if (status === 'inactive') conditions.push('is_active = false');

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const countQuery = `SELECT COUNT(*) as count FROM surveys ${whereClause}`;
    const totalResult = await queryOne<{ count: string }>(countQuery, params);
    const total = parseInt(totalResult?.count || '0');

    const surveysQuery = `
      SELECT s.*, u.name as created_by_name 
      FROM surveys s 
      LEFT JOIN users u ON s.created_by = u.id 
      ${whereClause}
      ORDER BY s.created_at DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const data = await query(surveysQuery, params);
    return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
  },

  async getSurveyResponses(surveyId: string, page: number, limit: number) {
    const offset = (page - 1) * limit;

    if (isFallback()) {
      const responses = memStore.survey_responses.filter(r => r.survey_id === surveyId);
      const total = responses.length;
      const data = responses.slice(offset, offset + limit);

      return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
    }

    const countQuery = `SELECT COUNT(*) as count FROM survey_responses WHERE survey_id = $1`;
    const totalResult = await queryOne<{ count: string }>(countQuery, [surveyId]);
    const total = parseInt(totalResult?.count || '0');

    const responsesQuery = `
      SELECT sr.*, u.name as user_name 
      FROM survey_responses sr 
      LEFT JOIN users u ON sr.user_id = u.id 
      WHERE sr.survey_id = $1 
      ORDER BY sr.submitted_at DESC 
      LIMIT $2 OFFSET $3
    `;

    const data = await query(responsesQuery, [surveyId, limit, offset]);
    return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
  },

  async getSurveyAnalytics(surveyId: string) {
    if (isFallback()) {
      const responses = memStore.survey_responses.filter(r => r.survey_id === surveyId);
      return {
        total_responses: responses.length,
        completion_rate: 100,
        average_completion_time: 300,
        response_trend: [],
      };
    }

    const analyticsQuery = `
      SELECT 
        COUNT(*) as total_responses,
        AVG(EXTRACT(EPOCH FROM (submitted_at - created_at))) as avg_completion_time
      FROM survey_responses sr
      JOIN surveys s ON sr.survey_id = s.id
      WHERE sr.survey_id = $1
    `;

    const analytics = await queryOne(analyticsQuery, [surveyId]);
    
    const trendQuery = `
      SELECT 
        DATE(submitted_at) as date,
        COUNT(*) as responses
      FROM survey_responses 
      WHERE survey_id = $1 
      GROUP BY DATE(submitted_at) 
      ORDER BY date DESC 
      LIMIT 30
    `;

    const trend = await query(trendQuery, [surveyId]);

    return {
      total_responses: parseInt(String(analytics?.total_responses ?? '0')),
      completion_rate: 100,
      average_completion_time: parseInt(String(analytics?.avg_completion_time ?? '300')),
      response_trend: trend,
    };
  },

  async exportSurveyResponses(surveyId: string, format: string) {
    if (isFallback()) {
      const responses = memStore.survey_responses.filter(r => r.survey_id === surveyId);
      
      if (format === 'csv') {
        let csv = 'ID,Name,Email,Phone,Submitted At\n';
        responses.forEach(r => {
          csv += `${r.id},"${r.respondent_name || ''}","${r.respondent_email || ''}","${r.respondent_phone || ''}",${r.submitted_at}\n`;
        });
        return csv;
      }
      
      return JSON.stringify(responses, null, 2);
    }

    const exportQuery = `
      SELECT sr.*, u.name as user_name
      FROM survey_responses sr 
      LEFT JOIN users u ON sr.user_id = u.id 
      WHERE sr.survey_id = $1 
      ORDER BY sr.submitted_at DESC
    `;

    const responses = await query(exportQuery, [surveyId]);

    if (format === 'csv') {
      let csv = 'ID,User Name,Name,Email,Phone,Submitted At\n';
      responses.forEach((r: any) => {
        csv += `${r.id},"${r.user_name || ''}","${r.respondent_name || ''}","${r.respondent_email || ''}","${r.respondent_phone || ''}",${r.submitted_at}\n`;
      });
      return csv;
    }

    return JSON.stringify(responses, null, 2);
  },

  async bulkDelete(ids: string[]) {
    if (isFallback()) {
      ids.forEach(id => {
        const index = memStore.surveys.findIndex(s => s.id === id);
        if (index !== -1) memStore.surveys.splice(index, 1);
        
        // Remove related data
        memStore.survey_questions = memStore.survey_questions.filter(q => q.survey_id !== id);
        const responseIds = memStore.survey_responses.filter(r => r.survey_id === id).map(r => r.id);
        memStore.survey_responses = memStore.survey_responses.filter(r => r.survey_id !== id);
        memStore.survey_answers = memStore.survey_answers.filter(a => !responseIds.includes(a.response_id));
      });
      return;
    }

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    await query(`DELETE FROM surveys WHERE id IN (${placeholders})`, ids);
  },
};