import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL || 'postgresql://neondb_owner:npg_awv05bnxWUoi@ep-steep-bread-at5en99t.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('Adding featured_on_home columns...');
  await pool.query('ALTER TABLE news ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false');
  await pool.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false');
  await pool.query('ALTER TABLE surveys ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false');
  console.log('Done!');
  await pool.end();
}

run().catch(e => { console.error(e); process.exit(1); });
