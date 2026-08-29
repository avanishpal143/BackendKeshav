-- Run this SQL in your database to add the featured_on_home column
-- You can run it via: psql $POSTGRES_URL -f scripts/migration-featured.sql
-- Or paste it in Neon console

ALTER TABLE news ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS featured_on_home BOOLEAN DEFAULT false;
