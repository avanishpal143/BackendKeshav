-- Create global_otp table for persistent OTP storage
-- Run this in Neon Console SQL editor

CREATE TABLE IF NOT EXISTS global_otp (
  id          SERIAL PRIMARY KEY,
  otp         VARCHAR(10) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  VARCHAR(100) NOT NULL DEFAULT 'system',
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default OTP if table is empty
INSERT INTO global_otp (otp, is_active, created_by, usage_count)
SELECT '425722', true, 'system', 0
WHERE NOT EXISTS (SELECT 1 FROM global_otp);

CREATE INDEX IF NOT EXISTS idx_global_otp_active ON global_otp(is_active, created_at DESC);
