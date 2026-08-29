-- ============================================================
-- Community Connect — PostgreSQL Schema
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";  -- optional, for geo queries

-- ============================================================
-- ENUM types
-- ============================================================
CREATE TYPE user_role AS ENUM ('user','staff','volunteer','district_admin','state_admin','super_admin');
CREATE TYPE blood_group AS ENUM ('A+','A-','B+','B-','AB+','AB-','O+','O-');
CREATE TYPE sos_status AS ENUM ('pending','assigned','resolved','cancelled');
CREATE TYPE complaint_status AS ENUM ('open','in_progress','resolved','closed');
CREATE TYPE blood_request_status AS ENUM ('open','fulfilled','expired','cancelled');
CREATE TYPE notification_type AS ENUM ('sos','blood','complaint','event','news','system');

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(120) NOT NULL,
  mobile        VARCHAR(15) UNIQUE NOT NULL,
  email         VARCHAR(200) UNIQUE,
  google_id     VARCHAR(200) UNIQUE,
  avatar_url    TEXT,
  role          user_role NOT NULL DEFAULT 'user',
  blood_group   blood_group,
  district      VARCHAR(100),
  state         VARCHAR(100),
  village       VARCHAR(100),
  address       TEXT,
  latitude      DOUBLE PRECISION,
  longitude     DOUBLE PRECISION,
  member_id     VARCHAR(30) UNIQUE,
  fcm_token     TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  is_verified   BOOLEAN NOT NULL DEFAULT false,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_mobile ON users(mobile);
CREATE INDEX idx_users_district ON users(district);
CREATE INDEX idx_users_blood_group ON users(blood_group);
CREATE INDEX idx_users_role ON users(role);

-- ============================================================
-- FAMILIES
-- ============================================================
CREATE TABLE IF NOT EXISTS families (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_name VARCHAR(120),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS family_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id   UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users(id),
  name        VARCHAR(120) NOT NULL,
  relation    VARCHAR(60) NOT NULL,
  age         SMALLINT,
  blood_group blood_group,
  mobile      VARCHAR(15),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_family_members_family ON family_members(family_id);

-- ============================================================
-- STAFF & VOLUNTEERS
-- ============================================================
CREATE TABLE IF NOT EXISTS staff (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  designation  VARCHAR(100),
  department   VARCHAR(100),
  district     VARCHAR(100),
  state        VARCHAR(100),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS volunteers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill        VARCHAR(200),
  district     VARCHAR(100),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- BLOOD DONORS
-- ============================================================
CREATE TABLE IF NOT EXISTS blood_donors (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blood_group      blood_group NOT NULL,
  is_available     BOOLEAN NOT NULL DEFAULT true,
  last_donated_at  DATE,
  district         VARCHAR(100),
  state            VARCHAR(100),
  latitude         DOUBLE PRECISION,
  longitude        DOUBLE PRECISION,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blood_donors_group ON blood_donors(blood_group);
CREATE INDEX idx_blood_donors_district ON blood_donors(district);
CREATE INDEX idx_blood_donors_available ON blood_donors(is_available);

-- ============================================================
-- BLOOD REQUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS blood_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id     UUID NOT NULL REFERENCES users(id),
  blood_group      blood_group NOT NULL,
  units_needed     SMALLINT NOT NULL DEFAULT 1,
  hospital_name    VARCHAR(200),
  district         VARCHAR(100),
  state            VARCHAR(100),
  contact_mobile   VARCHAR(15),
  notes            TEXT,
  status           blood_request_status NOT NULL DEFAULT 'open',
  urgency          VARCHAR(20) NOT NULL DEFAULT 'normal',
  fulfilled_by     UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blood_requests_group ON blood_requests(blood_group);
CREATE INDEX idx_blood_requests_status ON blood_requests(status);
CREATE INDEX idx_blood_requests_district ON blood_requests(district);

-- ============================================================
-- COMPLAINTS
-- ============================================================
CREATE TABLE IF NOT EXISTS complaints (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id),
  title           VARCHAR(200) NOT NULL,
  description     TEXT NOT NULL,
  category        VARCHAR(60) NOT NULL,
  status          complaint_status NOT NULL DEFAULT 'open',
  district        VARCHAR(100),
  state           VARCHAR(100),
  village         VARCHAR(100),
  image_urls      TEXT[],
  assigned_to     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS complaint_timeline (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  complaint_id   UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  action         VARCHAR(200) NOT NULL,
  actor_id       UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_complaints_user ON complaints(user_id);
CREATE INDEX idx_complaints_status ON complaints(status);
CREATE INDEX idx_complaints_district ON complaints(district);

-- ============================================================
-- POLICE STATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS police_stations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(200) NOT NULL,
  type        VARCHAR(100) DEFAULT 'Police Station',
  district    VARCHAR(100) NOT NULL,
  state       VARCHAR(100) NOT NULL,
  phone       VARCHAR(15),
  address     TEXT,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_police_district ON police_stations(district);

-- ============================================================
-- HOSPITALS
-- ============================================================
CREATE TABLE IF NOT EXISTS hospitals (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(200) NOT NULL,
  type        VARCHAR(100) DEFAULT 'Government Hospital',
  district    VARCHAR(100) NOT NULL,
  state       VARCHAR(100) NOT NULL,
  phone       VARCHAR(15),
  address     TEXT,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  beds        INTEGER,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_hospitals_district ON hospitals(district);

-- ============================================================
-- SOS ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS sos_alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id),
  latitude        DOUBLE PRECISION NOT NULL,
  longitude       DOUBLE PRECISION NOT NULL,
  address         TEXT,
  status          sos_status NOT NULL DEFAULT 'pending',
  assigned_to     UUID REFERENCES users(id),
  whatsapp_sent   BOOLEAN NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sos_user ON sos_alerts(user_id);
CREATE INDEX idx_sos_status ON sos_alerts(status);
CREATE INDEX idx_sos_created ON sos_alerts(created_at DESC);

-- ============================================================
-- NEWS (ADVANCED)
-- ============================================================
CREATE TABLE IF NOT EXISTS news (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title         VARCHAR(200) NOT NULL,
  summary       TEXT NOT NULL,
  body          TEXT NOT NULL,
  category      VARCHAR(60) NOT NULL,
  tags          TEXT,
  image_url     TEXT,
  video_url     TEXT,
  district      VARCHAR(100),
  state         VARCHAR(100),
  priority      VARCHAR(20) DEFAULT 'medium',
  published     BOOLEAN NOT NULL DEFAULT false,
  author_id     UUID NOT NULL REFERENCES users(id),
  view_count    INTEGER DEFAULT 0,
  published_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_news_published ON news(published, created_at DESC);
CREATE INDEX idx_news_category ON news(category);
CREATE INDEX idx_news_district ON news(district);
CREATE INDEX idx_news_author ON news(author_id);

-- ============================================================
-- EVENTS (ADVANCED)
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                 VARCHAR(200) NOT NULL,
  description           TEXT NOT NULL,
  venue                 VARCHAR(200) NOT NULL,
  address               TEXT,
  district              VARCHAR(100) NOT NULL,
  state                 VARCHAR(100) NOT NULL,
  category              VARCHAR(60) NOT NULL,
  type                  VARCHAR(30) DEFAULT 'free',
  max_capacity          INTEGER,
  registration_required BOOLEAN DEFAULT false,
  image_url             TEXT,
  video_url             TEXT,
  contact_name          VARCHAR(120),
  contact_phone         VARCHAR(15),
  contact_email         VARCHAR(200),
  tags                  TEXT,
  starts_at             TIMESTAMPTZ NOT NULL,
  ends_at               TIMESTAMPTZ,
  registration_deadline TIMESTAMPTZ,
  latitude              DOUBLE PRECISION,
  longitude             DOUBLE PRECISION,
  organizer_id          UUID NOT NULL REFERENCES users(id),
  is_active             BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_district ON events(district);
CREATE INDEX idx_events_starts ON events(starts_at);
CREATE INDEX idx_events_category ON events(category);
CREATE INDEX idx_events_organizer ON events(organizer_id);

-- Event Registrations
CREATE TABLE IF NOT EXISTS event_registrations (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id             UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id              UUID REFERENCES users(id),
  name                 VARCHAR(120) NOT NULL,
  mobile               VARCHAR(15) NOT NULL,
  email                VARCHAR(200),
  family_members_count INTEGER DEFAULT 1,
  status               VARCHAR(20) DEFAULT 'confirmed',
  registered_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_registrations_event ON event_registrations(event_id);
CREATE INDEX idx_event_registrations_user ON event_registrations(user_id);

-- ============================================================
-- SURVEYS (ADVANCED)
-- ============================================================
CREATE TABLE IF NOT EXISTS surveys (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title                   VARCHAR(200) NOT NULL,
  description             TEXT NOT NULL,
  category                VARCHAR(60) NOT NULL,
  target_audience         VARCHAR(30) DEFAULT 'all',
  district                VARCHAR(100),
  state                   VARCHAR(100),
  is_anonymous            BOOLEAN DEFAULT false,
  allow_multiple_responses BOOLEAN DEFAULT false,
  starts_at               TIMESTAMPTZ,
  ends_at                 TIMESTAMPTZ,
  max_responses           INTEGER,
  created_by              UUID NOT NULL REFERENCES users(id),
  is_active               BOOLEAN NOT NULL DEFAULT true,
  response_count          INTEGER DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_surveys_category ON surveys(category);
CREATE INDEX idx_surveys_active ON surveys(is_active);
CREATE INDEX idx_surveys_created_by ON surveys(created_by);

-- Survey Questions
CREATE TABLE IF NOT EXISTS survey_questions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id      UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  question_type  VARCHAR(20) NOT NULL,
  title          VARCHAR(300) NOT NULL,
  description    TEXT,
  required       BOOLEAN DEFAULT false,
  options        TEXT,
  min_rating     INTEGER,
  max_rating     INTEGER,
  question_order INTEGER NOT NULL
);

CREATE INDEX idx_survey_questions_survey ON survey_questions(survey_id, question_order);

-- Survey Responses
CREATE TABLE IF NOT EXISTS survey_responses (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  survey_id         UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  user_id           UUID REFERENCES users(id),
  respondent_name   VARCHAR(120),
  respondent_email  VARCHAR(200),
  respondent_phone  VARCHAR(15),
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_survey_responses_survey ON survey_responses(survey_id);
CREATE INDEX idx_survey_responses_user ON survey_responses(user_id);

-- Survey Answers
CREATE TABLE IF NOT EXISTS survey_answers (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  response_id  UUID NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  question_id  UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  answer_text  TEXT,
  answer_number NUMERIC,
  answer_array TEXT
);

CREATE INDEX idx_survey_answers_response ON survey_answers(response_id);
CREATE INDEX idx_survey_answers_question ON survey_answers(question_id);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  body        TEXT NOT NULL,
  type        notification_type NOT NULL DEFAULT 'system',
  ref_id      UUID,
  is_read     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

-- ============================================================
-- NEWS / COMMUNITY POSTS
-- ============================================================
-- (Replaced by advanced NEWS table above)

-- ============================================================
-- REFRESH TOKENS
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ============================================================
-- BANNERS (Home Screen)
-- ============================================================
CREATE TABLE IF NOT EXISTS banners (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       VARCHAR(200) NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  image_url   TEXT,
  video_url   TEXT,
  link_type   VARCHAR(30),  -- 'news' | 'event' | 'survey' | 'external'
  link_id     VARCHAR(500), -- ID or external URL
  cta_text    VARCHAR(100),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_banners_active ON banners(is_active, sort_order);
