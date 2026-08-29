import { config } from 'dotenv';
config();

import http from 'http';
import app from './app.js';
import { connectPostgres } from './infrastructure/database/postgres.js';
import { connectMongo } from './infrastructure/database/mongo.js';
import { connectRedis } from './infrastructure/cache/redis.js';
import { initSocketServer } from './infrastructure/realtime/socket.js';
import { initFirebase } from './infrastructure/push/firebase.js';
import { logger } from './shared/logger.js';

const PORT = Number(process.env.PORT) || 8080;

// ── Trust proxy (required for Hostinger/reverse proxy) ───────────────────────
app.set('trust proxy', 1);

// ── Start server IMMEDIATELY (Hostinger requires listen within 3 seconds) ────
const server = http.createServer(app);
initSocketServer(server);

server.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 KJV Foundation API running on port ${PORT}`);
  logger.info(`   Environment: ${process.env.NODE_ENV}`);
  logger.info(`   URL: http://localhost:${PORT}`);
});

// ── Connect databases in background (non-blocking) ───────────────────────────
(async () => {
  try {
    await connectPostgres();
    await connectMongo();
    await connectRedis();
    initFirebase();
    logger.info('✅ All services connected');
  } catch (err) {
    logger.error('Service connection error (non-fatal):', err);
  }
})();

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection', err);
});
