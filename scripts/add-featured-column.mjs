#!/usr/bin/env node
/**
 * Migration: Add featured_on_home column to news, events, surveys tables
 * Run: node scripts/add-featured-column.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.POSTGRES_URL || 'postgresql://neondb_owner:npg_awv05bnxWUoi@ep-steep-bread-at5en99t.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require',
  ssl: { rejectUnauthorized: false },
});

async function run() {
  await client.connect();
  console.log('Adding featured_on_home columns...');
  await client.query('ALTER TABLE news ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false');
  await client.query('ALTER TABLE events ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false');
  await client.query('ALTER TABLE surveys ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false');
  console.log('Done!');
  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
