import { Router } from 'express';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { ActivityLog } from '../../infrastructure/database/models/ActivityLog.js';
import { success } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { appSettings, payments } from './settings.js';
import { authService } from '../auth/auth.service.js';

const router = Router();
router.use(authenticate);
router.use(requireRole('super_admin', 'state_admin', 'district_admin', 'staff'));

// ── OTP Management ────────────────────────────────────────────────────────────

// GET /admin/otp-status — current OTP status (all OTPs)
router.get('/otp-status', async (_req, res, next) => {
  try {
    const status = await authService.getGlobalOtpStatus();
    success(res, status);
  } catch (err) { next(err); }
});

// POST /admin/generate-otp — generate a new OTP (does NOT deactivate existing)
router.post('/generate-otp', async (req, res, next) => {
  try {
    const otp = authService.generateNewOtp(req.user!.userId);
    success(res, {
      otp,
      isActive: true,
      message: `New OTP created: ${otp}. It will stay active until you deactivate it.`,
    });
  } catch (err) { next(err); }
});

// PATCH /admin/otp-toggle — activate or deactivate a specific OTP
router.patch('/otp-toggle', async (req, res, next) => {
  try {
    const { active, otp } = req.body as { active: boolean; otp?: string };
    const result = await authService.toggleOtp(active, otp);
    success(res, { ...result, message: active ? 'OTP activated' : 'OTP deactivated' });
  } catch (err) { next(err); }
});

// ── App Settings (prices) ─────────────────────────────────────────────────────

// GET /admin/settings
router.get('/settings', async (_req, res, next) => {
  try {
    success(res, appSettings);
  } catch (err) { next(err); }
});

// PUT /admin/settings — update prices
router.put('/settings', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const { registrationFee, monthlyFee, otpValidityMinutes } = req.body as {
      registrationFee?: number;
      monthlyFee?: number;
      otpValidityMinutes?: number;
    };
    if (registrationFee !== undefined && registrationFee >= 0) appSettings.registrationFee = registrationFee;
    if (monthlyFee !== undefined && monthlyFee >= 0) appSettings.monthlyFee = monthlyFee;
    if (otpValidityMinutes !== undefined && otpValidityMinutes > 0) appSettings.otpValidityMinutes = otpValidityMinutes;
    appSettings.updatedAt = new Date().toISOString();
    appSettings.updatedBy = req.user!.userId;
    success(res, appSettings);
  } catch (err) { next(err); }
});

// ── Payments ──────────────────────────────────────────────────────────────────

// GET /admin/payments
router.get('/payments', async (_req, res, next) => {
  try {
    const { payments } = await import('./settings.js');
    success(res, payments.slice().reverse());
  } catch (err) { next(err); }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

// GET /admin/dashboard — analytics
router.get('/dashboard', async (_req, res, next) => {
  try {
    if (isFallback()) {
      const users = memStore.users.filter(u => u.role === 'user').length;
      const staff = memStore.staff.filter(s => s.is_active).length;
      const bloodDonors = memStore.bloodDonors.length;
      const openBloodRequests = memStore.bloodRequests.filter(r => r.status === 'open').length;
      const pendingSos = memStore.sosAlerts.filter(s => s.status === 'pending').length;
      const activeComplaints = memStore.complaints.filter(c => c.status !== 'closed').length;
      const upcomingEvents = memStore.events.filter(e => e.is_active && new Date(e.starts_at) >= new Date()).length;
      const volunteers = memStore.users.filter(u => u.role === 'volunteer').length;
      const families = memStore.families.length;

      // Blood group stats
      const groups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      const bloodGroupStats = groups
        .map(g => ({ blood_group: g, count: String(memStore.bloodDonors.filter(d => d.blood_group === g).length) }))
        .filter(s => parseInt(s.count) > 0);

      // District complaints
      const distMap = new Map<string, number>();
      memStore.complaints.forEach(c => { distMap.set(c.district, (distMap.get(c.district) ?? 0) + 1); });
      const districtComplaints = [...distMap.entries()]
        .map(([district, count]) => ({ district, count: String(count) }))
        .sort((a, b) => parseInt(b.count) - parseInt(a.count))
        .slice(0, 10);

      // Monthly users (last 6 months — simplified)
      const monthlyUsers = [
        { month: 'Jan 2024', count: '2' },
        { month: 'Feb 2024', count: '1' },
        { month: 'Mar 2024', count: '1' },
        { month: 'Apr 2024', count: '1' },
        { month: 'May 2024', count: '1' },
        { month: 'Jun 2024', count: '1' },
      ];

      return success(res, {
        totals: { users, families, bloodDonors, openBloodRequests, pendingSos, activeComplaints, upcomingEvents, staff, volunteers },
        charts: { monthlyUsers, bloodGroupStats, districtComplaints },
        recentActivity: {
          sosAlerts: memStore.sosAlerts.slice().reverse().slice(0, 5).map(s => ({ id: s.id, name: s.name, mobile: s.mobile, district: s.district, status: s.status, address: s.address, created_at: s.created_at })),
          complaints: memStore.complaints.slice().reverse().slice(0, 5).map(c => ({ id: c.id, title: c.title, category: c.category, status: c.status, district: c.district, user_name: c.user_name, created_at: c.created_at })),
          bloodRequests: memStore.bloodRequests.slice().reverse().slice(0, 5).map(r => ({ id: r.id, blood_group: r.blood_group, units_needed: r.units_needed, hospital_name: r.hospital_name, status: r.status, requester_name: r.requester_name, urgency: r.urgency, created_at: r.created_at })),
        },
      });
    }

    const [users, families, bloodDonors, bloodRequests, sos, complaints, events, staff, volunteers] = await Promise.all([
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM users WHERE role=$1', ['user']),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM families'),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM blood_donors'),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM blood_requests WHERE status=$1', ['open']),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM sos_alerts WHERE status=$1', ['pending']),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM complaints WHERE status!=$1', ['closed']),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM events WHERE is_active=true AND starts_at >= NOW()'),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM staff WHERE is_active=true'),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM volunteers WHERE is_active=true'),
    ]);
    const monthlyUsers = await query(`SELECT TO_CHAR(DATE_TRUNC('month',created_at),'Mon YYYY') as month, COUNT(*) as count FROM users WHERE created_at > NOW()-INTERVAL '6 months' GROUP BY DATE_TRUNC('month',created_at) ORDER BY DATE_TRUNC('month',created_at)`);
    const bloodGroupStats = await query(`SELECT blood_group, COUNT(*) as count FROM blood_donors GROUP BY blood_group ORDER BY blood_group`);
    const districtComplaints = await query(`SELECT district, COUNT(*) as count FROM complaints WHERE district IS NOT NULL AND district != '' GROUP BY district ORDER BY count DESC LIMIT 10`);
    const recentSos = await query(`SELECT sa.id, u.name, u.mobile, u.district, sa.status, sa.address, sa.created_at FROM sos_alerts sa JOIN users u ON sa.user_id=u.id ORDER BY sa.created_at DESC LIMIT 5`);
    const recentComplaints = await query(`SELECT c.id, c.title, c.category, c.status, c.district, u.name as user_name, c.created_at FROM complaints c JOIN users u ON c.user_id=u.id ORDER BY c.created_at DESC LIMIT 5`);
    const recentBloodRequests = await query(`SELECT br.id, br.blood_group, br.units_needed, br.hospital_name, br.status, u.name as requester_name, br.urgency, br.created_at FROM blood_requests br JOIN users u ON br.requester_id=u.id ORDER BY br.created_at DESC LIMIT 5`);
    success(res, {
      totals: { users: parseInt(users?.count ?? '0'), families: parseInt(families?.count ?? '0'), bloodDonors: parseInt(bloodDonors?.count ?? '0'), openBloodRequests: parseInt(bloodRequests?.count ?? '0'), pendingSos: parseInt(sos?.count ?? '0'), activeComplaints: parseInt(complaints?.count ?? '0'), upcomingEvents: parseInt(events?.count ?? '0'), staff: parseInt(staff?.count ?? '0'), volunteers: parseInt(volunteers?.count ?? '0') },
      charts: { monthlyUsers, bloodGroupStats, districtComplaints },
      recentActivity: { sosAlerts: recentSos, complaints: recentComplaints, bloodRequests: recentBloodRequests },
    });
  } catch (err) { next(err); }
});

// GET /audit-logs
router.get('/audit-logs', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = 50;
    const skip = (page - 1) * limit;
    const logs = await ActivityLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean().catch(() => []);
    const total = await ActivityLog.countDocuments().catch(() => 0);
    success(res, { data: logs, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
});

// PATCH /users/:id/role
router.patch('/users/:id/role', requireRole('super_admin', 'state_admin'), async (req, res, next) => {
  try {
    const { role } = req.body;
    const validRoles = ['user', 'staff', 'volunteer', 'district_admin', 'state_admin'];
    if (!validRoles.includes(role)) return res.status(400).json({ success: false, error: 'Invalid role' });

    if (isFallback()) {
      const user = memStore.users.find(u => u.id === req.params.id);
      if (user) user.role = role;
      return success(res, user ? { id: user.id, name: user.name, role: user.role } : null);
    }
    const rows = await query('UPDATE users SET role=$1 WHERE id=$2 RETURNING id,name,role', [role, req.params.id]);
    success(res, rows[0]);
  } catch (err) { next(err); }
});

// Reports
router.get('/reports/sos', async (req, res, next) => {
  try {
    if (isFallback()) {
      let items = [...memStore.sosAlerts];
      if (req.query.district) items = items.filter(s => s.district === req.query.district);
      return success(res, items);
    }
    const { startDate, endDate, district } = req.query as Record<string, string>;
    const conds = ['1=1']; const params: unknown[] = []; let p = 1;
    if (startDate) { conds.push(`sa.created_at>=$${p++}`); params.push(startDate); }
    if (endDate) { conds.push(`sa.created_at<=$${p++}`); params.push(endDate); }
    if (district) { conds.push(`u.district=$${p++}`); params.push(district); }
    const rows = await query(`SELECT sa.*,u.name,u.mobile,u.district FROM sos_alerts sa JOIN users u ON sa.user_id=u.id WHERE ${conds.join(' AND ')} ORDER BY sa.created_at DESC`, params);
    success(res, rows);
  } catch (err) { next(err); }
});

router.get('/reports/blood', async (req, res, next) => {
  try {
    if (isFallback()) return success(res, memStore.bloodRequests);
    const rows = await query('SELECT br.*,u.name as requester FROM blood_requests br JOIN users u ON br.requester_id=u.id ORDER BY br.created_at DESC LIMIT 500');
    success(res, rows);
  } catch (err) { next(err); }
});

router.get('/reports/complaints', async (req, res, next) => {
  try {
    if (isFallback()) {
      let items = [...memStore.complaints];
      if (req.query.district) items = items.filter(c => c.district === req.query.district);
      if (req.query.status) items = items.filter(c => c.status === req.query.status);
      return success(res, items);
    }
    const { district, status } = req.query as Record<string, string>;
    const conds = ['1=1']; const params: unknown[] = []; let p = 1;
    if (district) { conds.push(`district=$${p++}`); params.push(district); }
    if (status) { conds.push(`status=$${p++}`); params.push(status); }
    const rows = await query(`SELECT c.*,u.name FROM complaints c JOIN users u ON c.user_id=u.id WHERE ${conds.join(' AND ')} ORDER BY c.created_at DESC LIMIT 1000`, params);
    success(res, rows);
  } catch (err) { next(err); }
});

export default router;
