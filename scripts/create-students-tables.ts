import pg from 'pg';
import { config } from 'dotenv';
config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('Creating courses and students tables...');
  
  // Create courses table FIRST (students references it)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name        VARCHAR(200) NOT NULL,
      description TEXT,
      category    VARCHAR(100),
      duration    VARCHAR(50),
      is_active   BOOLEAN DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('✅ courses table created');

  // Create students table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS students (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name            VARCHAR(150) NOT NULL,
      mobile          VARCHAR(15),
      email           VARCHAR(200),
      father_name     VARCHAR(150),
      address         TEXT,
      district        VARCHAR(100),
      state           VARCHAR(100),
      course_id       UUID REFERENCES courses(id),
      batch           VARCHAR(50),
      enrollment_date DATE DEFAULT CURRENT_DATE,
      status          VARCHAR(20) DEFAULT 'active',
      notes           TEXT,
      created_by      UUID REFERENCES users(id),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('✅ students table created');

  // Create indexes
  await pool.query('CREATE INDEX IF NOT EXISTS idx_students_course ON students(course_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_students_status ON students(status)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_courses_active ON courses(is_active)');
  console.log('✅ indexes created');

  // Also add missing columns to other tables
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT \'{}\'');
  await pool.query('ALTER TABLE news ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false');
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false');
  await pool.query('ALTER TABLE surveys ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false');
  console.log('✅ missing columns added (settings, featured_on_home)');

  console.log('\nAll done!');
  await pool.end();
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
