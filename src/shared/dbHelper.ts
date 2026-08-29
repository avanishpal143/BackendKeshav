/**
 * Transparent DB helper — automatically uses memory store when
 * DB_MEMORY_FALLBACK=true, real PostgreSQL/MongoDB otherwise.
 */

export const isFallback = () => process.env.DB_MEMORY_FALLBACK === 'true';
