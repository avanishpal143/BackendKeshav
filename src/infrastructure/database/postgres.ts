import pg from 'pg';
import { logger } from '../../shared/logger.js';

const { Pool } = pg;

const isFallback = () => process.env.DB_MEMORY_FALLBACK === 'true';

// Only create pool if not in fallback mode
let pool: InstanceType<typeof Pool> | null = null;

function getPool(): InstanceType<typeof Pool> {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL;
    pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: connectionString?.includes('sslmode=')
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return pool;
}

export async function connectPostgres() {
  if (isFallback()) {
    logger.warn('PostgreSQL: DB_MEMORY_FALLBACK=true — skipping real connection');
    return;
  }
  try {
    const client = await getPool().connect();
    client.release();
    logger.info('✅ PostgreSQL connected');
  } catch (err) {
    logger.warn('PostgreSQL: connection failed', err);
  }
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  if (isFallback()) return [];
  const result = await getPool().query(sql, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  if (isFallback()) return null;
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}
