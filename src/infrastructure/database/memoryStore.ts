/**
 * In-memory data store — used when DB_MEMORY_FALLBACK=true
 * Gives the app real working data without needing PostgreSQL/MongoDB
 */

import { v4 as uuidv4 } from 'uuid';

export interface MemUser {
  id: string; name: string; mobile: string; role: string;
  district: string; state: string; blood_group: string;
  member_id: string; is_active: boolean; is_verified: boolean;
  avatar_url: string | null; fcm_token: string | null;
  password_hash: string | null; created_at: string;
  settings?: Record<string, unknown>;
}

export interface MemBloodDonor {
  id: string; user_id: string; name: string; mobile: string;
  blood_group: string; is_available: boolean;
  last_donated_at: string | null; district: string; state: string;
  latitude: number; longitude: number; created_at: string;
}

export interface MemPolice {
  id: string; name: string; type: string; district: string;
  state: string; phone: string; address: string;
  latitude: number; longitude: number; is_active: boolean;
}

export interface MemHospital {
  id: string; name: string; type: string; district: string;
  state: string; phone: string; address: string;
  latitude: number; longitude: number; beds: number; is_active: boolean;
}

export interface MemComplaint {
  id: string; user_id: string; user_name: string; title: string;
  description: string; category: string; status: string;
  district: string; state: string; village: string;
  created_at: string; updated_at: string;
  timeline: Array<{ action: string; created_at: string }>;
}

export interface MemSos {
  id: string; user_id: string; name: string; mobile: string;
  district: string; latitude: number; longitude: number;
  address: string; status: string; assigned_to: string | null;
  notes: string | null; created_at: string; updated_at: string;
}

export interface MemBloodRequest {
  id: string; requester_id: string; requester_name: string;
  requester_mobile: string; blood_group: string; units_needed: number;
  hospital_name: string; district: string; state: string;
  contact_mobile: string; notes: string; urgency: string;
  status: string; created_at: string; updated_at: string;
}

export interface MemEvent {
  id: string; title: string; description: string; venue: string;
  district: string; state: string; image_url: string | null;
  starts_at: string; ends_at: string | null; is_active: boolean;
  registrations_count?: number; category?: string;
  address?: string | null; type?: string; max_capacity?: number | null;
  registration_required?: boolean; video_url?: string | null;
  contact_name?: string | null; contact_phone?: string | null;
  contact_email?: string | null; tags?: string | null;
  registration_deadline?: string | null; latitude?: number | null;
  longitude?: number | null; organizer_id?: string;
  updated_at?: string;
  created_at: string;
}

export interface MemNews {
  id: string; title: string; summary: string; body: string;
  category: string; image_url: string | null; district: string | null;
  state: string | null; published: boolean; view_count?: number;
  priority?: string; author_id?: string; tags?: string | null;
  video_url?: string | null; published_at?: string | null;
  expires_at?: string | null; updated_at?: string;
  created_at: string;
}

export interface MemStaff {
  id: string; user_id: string; name: string; mobile: string;
  designation: string; department: string; district: string;
  state: string; is_active: boolean; role: string; avatar_url: string | null;
}

export interface MemNotification {
  id: string; user_id: string; title: string; body: string;
  type: string; is_read: boolean; created_at: string;
}

export interface MemFamily {
  id: string; owner_id: string; family_name?: string; members: Array<{
    id: string; name: string; relation: string; age: number;
    blood_group: string; mobile: string;
  }>;
}

export interface MemSurvey {
  id: string; title: string; description: string; category: string;
  target_audience: string; district: string | null; state: string | null;
  is_anonymous: boolean; allow_multiple_responses: boolean;
  starts_at: string | null; ends_at: string | null; max_responses: number | null;
  created_by: string; is_active: boolean; response_count: number;
  created_at: string; updated_at: string;
}

export interface MemSurveyQuestion {
  id: string; survey_id: string; type: string; title: string;
  description: string | null; required: boolean; options: string | null;
  min_rating: number | null; max_rating: number | null; order: number;
}

export interface MemSurveyResponse {
  id: string; survey_id: string; user_id: string | null;
  respondent_name: string | null; respondent_email: string | null;
  respondent_phone: string | null; submitted_at: string;
}

export interface MemSurveyAnswer {
  id: string; response_id: string; question_id: string;
  answer_text: string | null; answer_number: number | null; 
  answer_array: string | null;
}

export interface MemBanner {
  id: string; title: string; description: string;
  image_url: string | null; video_url: string | null;
  link_type: string | null; link_id: string | null;
  cta_text: string | null; is_active: boolean;
  sort_order: number; created_by: string; created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed data
// ─────────────────────────────────────────────────────────────────────────────
const now = () => new Date().toISOString();

export const memStore = {
  users: [
    { id: 'dev-admin-9996821315', name: 'Dev Super Admin', mobile: '9996821315', role: 'super_admin', district: 'Gurugram', state: 'Haryana', blood_group: 'O+', member_id: 'CC-ADMIN1', is_active: true, is_verified: true, avatar_url: null, fcm_token: null, password_hash: null, created_at: '2024-01-01T00:00:00.000Z' },
  ] as MemUser[],

  families: [] as MemFamily[],

  bloodDonors: [] as MemBloodDonor[],

  policeStations: [] as MemPolice[],

  hospitals: [] as MemHospital[],

  complaints: [] as MemComplaint[],

  sosAlerts: [] as MemSos[],

  bloodRequests: [] as MemBloodRequest[],

  events: [] as MemEvent[],

  news: [] as MemNews[],

  staff: [] as MemStaff[],

  notifications: [] as MemNotification[],

  // Survey data
  surveys: [] as MemSurvey[],

  survey_questions: [] as MemSurveyQuestion[],

  survey_responses: [] as MemSurveyResponse[],
  survey_answers: [] as MemSurveyAnswer[],

  banners: [] as MemBanner[],

  refreshTokens: new Map<string, { userId: string; expiresAt: Date }>(),
};

// Helper: find user by mobile
export function findUserByMobile(mobile: string): MemUser | null {
  return memStore.users.find(u => u.mobile === mobile) ?? null;
}

export function findUserById(id: string): MemUser | null {
  return memStore.users.find(u => u.id === id) ?? null;
}

export function createUser(data: Partial<MemUser> & { mobile: string; name: string }): MemUser {
  const user: MemUser = {
    id: uuidv4(),
    name: data.name,
    mobile: data.mobile,
    role: data.role ?? 'user',
    district: data.district ?? '',
    state: data.state ?? '',
    blood_group: data.blood_group ?? '',
    member_id: `CC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    is_active: true,
    is_verified: false,
    avatar_url: null,
    fcm_token: null,
    password_hash: null,
    created_at: now(),
  };
  memStore.users.push(user);
  return user;
}
