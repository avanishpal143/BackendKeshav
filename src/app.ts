import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { globalRateLimiter } from './shared/middleware/rateLimiter.js';
import { errorHandler } from './shared/middleware/errorHandler.js';
import { notFound } from './shared/middleware/notFound.js';
import authRoutes from './modules/auth/auth.routes.js';
import userRoutes from './modules/users/user.routes.js';
import familyRoutes from './modules/family/family.routes.js';
import bloodDonorRoutes from './modules/blood/bloodDonor.routes.js';
import bloodRequestRoutes from './modules/blood/bloodRequest.routes.js';
import policeRoutes from './modules/police/police.routes.js';
import hospitalRoutes from './modules/hospital/hospital.routes.js';
import sosRoutes from './modules/sos/sos.routes.js';
import complaintRoutes from './modules/complaints/complaint.routes.js';
import chatRoutes from './modules/chat/chat.routes.js';
import notificationRoutes from './modules/notifications/notification.routes.js';
import staffRoutes from './modules/staff/staff.routes.js';
import newsRoutes from './modules/news/news.routes.js';
import geoRoutes from './modules/geo/geo.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import healthRoutes from './modules/admin/health.routes.js';
import aboutRoutes from './modules/about/about.routes.js';
import postsRoutes from './modules/posts/posts.routes.js';
import subscriptionRoutes from './modules/subscription/subscription.routes.js';
import educationRoutes from './modules/education/education.routes.js';
import bannerRoutes from './modules/banner/banner.routes.js';
import feedRoutes from './modules/feed/feed.routes.js';
import studentRoutes from './modules/students/student.routes.js';

const app = express();

// Trust proxy (Hostinger/reverse proxy sets X-Forwarded-For)
app.set('trust proxy', 1);

// Security
app.use(helmet());
app.use(cors({
  origin: (_origin, callback) => {
    // Allow all origins in development (Flutter app, admin panel, Postman)
    callback(null, true);
  },
  credentials: true,
}));

// Request parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging
app.use(morgan('dev'));

// Rate limiting
app.use('/api', globalRateLimiter);

// Disable browser caching for all API responses — prevents 304 stale data issues
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
const v1 = '/api/v1';
app.use(`${v1}/auth`, authRoutes);
app.use(`${v1}/users`, userRoutes);
app.use(`${v1}/family`, familyRoutes);
app.use(`${v1}/blood-donors`, bloodDonorRoutes);
app.use(`${v1}/blood-requests`, bloodRequestRoutes);
app.use(`${v1}/police`, policeRoutes);
app.use(`${v1}/hospitals`, hospitalRoutes);
app.use(`${v1}/sos`, sosRoutes);
app.use(`${v1}/complaints`, complaintRoutes);
app.use(`${v1}/chat`, chatRoutes);
app.use(`${v1}/notifications`, notificationRoutes);
app.use(`${v1}/staff`, staffRoutes);
app.use(`${v1}/news`, newsRoutes);
app.use(`${v1}/geo`, geoRoutes);
app.use(`${v1}/admin`, adminRoutes);
app.use(`${v1}/about`, aboutRoutes);
app.use(`${v1}/posts`, postsRoutes);
app.use(`${v1}/subscription`, subscriptionRoutes);
app.use(`${v1}/education`, educationRoutes);
app.use(`${v1}/banners`, bannerRoutes);
app.use(`${v1}/feed`, feedRoutes);
app.use(`${v1}/students`, studentRoutes);
app.use('/api/health', healthRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

export default app;
