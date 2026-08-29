-- ============================================================
-- Run all pending migrations
-- Execute: paste this in Neon Console SQL editor
-- ============================================================

-- 1. Add settings column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';

-- 2. Add featured_on_home to news, events, surveys
ALTER TABLE news ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false;

-- 3. Create banners table (if not exists already)
CREATE TABLE IF NOT EXISTS banners (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title       VARCHAR(200) NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  image_url   TEXT,
  video_url   TEXT,
  link_type   VARCHAR(30),
  link_id     VARCHAR(500),
  cta_text    VARCHAR(100),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_banners_active ON banners(is_active, sort_order);

-- 4. Create students table for student data management
CREATE TABLE IF NOT EXISTS students (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(150) NOT NULL,
  mobile      VARCHAR(15),
  email       VARCHAR(200),
  father_name VARCHAR(150),
  address     TEXT,
  district    VARCHAR(100),
  state       VARCHAR(100),
  course_id   UUID REFERENCES courses(id),
  batch       VARCHAR(50),
  enrollment_date DATE DEFAULT CURRENT_DATE,
  status      VARCHAR(20) DEFAULT 'active',
  notes       TEXT,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_students_course ON students(course_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);

-- 5. Create courses table (dynamic courses)
CREATE TABLE IF NOT EXISTS courses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  category    VARCHAR(100),
  duration    VARCHAR(50),
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_courses_active ON courses(is_active);

-- 6. Add fcm_token column to users table for push notifications
ALTER TABLE users ADD COLUMN IF NOT EXISTS fcm_token TEXT;
CREATE INDEX IF NOT EXISTS idx_users_fcm_token ON users(fcm_token) WHERE fcm_token IS NOT NULL;
