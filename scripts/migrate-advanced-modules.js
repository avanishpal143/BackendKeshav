#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function migrateAdvancedModules() {
  const client = new pg.Client({
    connectionString: process.env.POSTGRES_URL,
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully!');

    // Update NEWS table
    console.log('Updating NEWS table...');
    await client.query(`
      -- Drop existing news table if it has old structure
      DROP TABLE IF EXISTS news CASCADE;
      
      -- Create advanced NEWS table
      CREATE TABLE news (
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
    `);

    // Update EVENTS table
    console.log('Updating EVENTS table...');
    await client.query(`
      -- Drop existing events table if it has old structure
      DROP TABLE IF EXISTS event_registrations CASCADE;
      DROP TABLE IF EXISTS events CASCADE;
      
      -- Create advanced EVENTS table
      CREATE TABLE events (
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

      -- Event Registrations table
      CREATE TABLE event_registrations (
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
    `);

    // Create SURVEYS tables
    console.log('Creating SURVEYS tables...');
    await client.query(`
      -- Drop existing surveys tables if they exist
      DROP TABLE IF EXISTS survey_answers CASCADE;
      DROP TABLE IF EXISTS survey_responses CASCADE;
      DROP TABLE IF EXISTS survey_questions CASCADE;
      DROP TABLE IF EXISTS surveys CASCADE;
      
      -- Create advanced SURVEYS table
      CREATE TABLE surveys (
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
      CREATE TABLE survey_questions (
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
      CREATE TABLE survey_responses (
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
      CREATE TABLE survey_answers (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        response_id  UUID NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
        question_id  UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
        answer_text  TEXT,
        answer_number NUMERIC,
        answer_array TEXT
      );

      CREATE INDEX idx_survey_answers_response ON survey_answers(response_id);
      CREATE INDEX idx_survey_answers_question ON survey_answers(question_id);
    `);

    console.log('Migration completed successfully!');
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrateAdvancedModules()
  .then(() => {
    console.log('Advanced modules migration completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });