import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireRole } from '../../shared/middleware/authenticate.js';
import { success, paginated } from '../../shared/response.js';
import { isFallback } from '../../shared/dbHelper.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { query, queryOne } from '../../infrastructure/database/postgres.js';

const router = Router();
router.use(authenticate);

// GET / — family members for current user
router.get('/', async (req, res, next) => {
  try {
    if (isFallback()) {
      const fam = memStore.families.find(f => f.owner_id === req.user!.userId);
      return success(res, fam?.members ?? []);
    }
    const family = await query('SELECT id FROM families WHERE owner_id=$1', [req.user!.userId]);
    if (!family.length) return success(res, []);
    const members = await query('SELECT * FROM family_members WHERE family_id=$1 ORDER BY created_at', [(family[0] as { id: string }).id]);
    success(res, members);
  } catch (err) { next(err); }
});

// GET /all — admin endpoint to get all families with pagination
router.get('/all', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const { search, district, state } = req.query as Record<string, string>;

    if (isFallback()) {
      let families = memStore.families.map(f => {
        const owner = memStore.users.find(u => u.id === f.owner_id);
        return {
          id: f.id,
          owner_id: f.owner_id,
          owner_name: owner?.name || 'Unknown',
          owner_mobile: owner?.mobile || '',
          owner_district: owner?.district || '',
          owner_state: owner?.state || '',
          family_name: `${owner?.name || 'Unknown'} Family`,
          members_count: f.members.length,
          members: f.members,
          created_at: new Date().toISOString()
        };
      });

      // Apply filters
      if (search) {
        families = families.filter(f => 
          f.owner_name.toLowerCase().includes(search.toLowerCase()) ||
          f.owner_mobile.includes(search) ||
          f.members.some(m => m.name.toLowerCase().includes(search.toLowerCase()))
        );
      }
      if (district) families = families.filter(f => f.owner_district === district);
      if (state) families = families.filter(f => f.owner_state === state);

      const total = families.length;
      return paginated(res, families.slice(offset, offset + limit), total, page, limit);
    }

    // Build dynamic query conditions
    const conditions = ['1=1'];
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(u.name ILIKE $${paramIndex} OR u.mobile LIKE $${paramIndex} OR EXISTS (
        SELECT 1 FROM family_members fm2 WHERE fm2.family_id = f.id AND fm2.name ILIKE $${paramIndex}
      ))`);
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (district) {
      conditions.push(`u.district = $${paramIndex}`);
      params.push(district);
      paramIndex++;
    }
    if (state) {
      conditions.push(`u.state = $${paramIndex}`);
      params.push(state);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    const [families, countResult] = await Promise.all([
      query(`
        SELECT 
          f.id, f.owner_id, f.family_name, f.created_at,
          u.name as owner_name, u.mobile as owner_mobile, 
          u.district as owner_district, u.state as owner_state,
          u.blood_group as owner_blood_group, u.member_id as owner_member_id,
          COUNT(fm.id) as members_count
        FROM families f
        LEFT JOIN users u ON f.owner_id = u.id
        LEFT JOIN family_members fm ON f.id = fm.family_id
        WHERE ${whereClause}
        GROUP BY f.id, f.owner_id, f.family_name, f.created_at, u.name, u.mobile, u.district, u.state, u.blood_group, u.member_id
        ORDER BY f.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(DISTINCT f.id) as count FROM families f LEFT JOIN users u ON f.owner_id = u.id WHERE ${whereClause}`, params)
    ]);

    // Get members for each family
    const familiesWithMembers = await Promise.all(
      families.map(async (family: any) => {
        const members = await query('SELECT * FROM family_members WHERE family_id = $1 ORDER BY created_at', [family.id]);
        return { ...family, members };
      })
    );

    paginated(res, familiesWithMembers, parseInt(countResult?.count ?? '0'), page, limit);
  } catch (err) { next(err); }
});

// GET /stats — family statistics
router.get('/stats', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    if (isFallback()) {
      const totalFamilies = memStore.families.length;
      const totalMembers = memStore.families.reduce((sum, f) => sum + f.members.length, 0);
      const avgMembersPerFamily = totalFamilies > 0 ? (totalMembers / totalFamilies).toFixed(1) : '0';
      
      const districtStats = memStore.users.reduce((acc, u) => {
        if (!acc[u.district]) acc[u.district] = 0;
        const family = memStore.families.find(f => f.owner_id === u.id);
        if (family) acc[u.district]++;
        return acc;
      }, {} as Record<string, number>);

      const relationStats = memStore.families.reduce((acc, f) => {
        f.members.forEach(m => {
          acc[m.relation] = (acc[m.relation] || 0) + 1;
        });
        return acc;
      }, {} as Record<string, number>);

      return success(res, {
        totalFamilies,
        totalMembers,
        avgMembersPerFamily: parseFloat(avgMembersPerFamily),
        districtStats: Object.entries(districtStats).map(([district, count]) => ({ district, count })),
        relationStats: Object.entries(relationStats).map(([relation, count]) => ({ relation, count }))
      });
    }

    const [totalFamilies, totalMembers, districtStats, relationStats] = await Promise.all([
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM families'),
      queryOne<{ count: string }>('SELECT COUNT(*) as count FROM family_members'),
      query(`
        SELECT u.district, COUNT(DISTINCT f.id) as count 
        FROM families f 
        JOIN users u ON f.owner_id = u.id 
        WHERE u.district IS NOT NULL AND u.district != ''
        GROUP BY u.district 
        ORDER BY count DESC
      `),
      query(`
        SELECT relation, COUNT(*) as count 
        FROM family_members 
        WHERE relation IS NOT NULL AND relation != ''
        GROUP BY relation 
        ORDER BY count DESC
      `)
    ]);

    const familyCount = parseInt(totalFamilies?.count ?? '0');
    const memberCount = parseInt(totalMembers?.count ?? '0');

    success(res, {
      totalFamilies: familyCount,
      totalMembers: memberCount,
      avgMembersPerFamily: familyCount > 0 ? parseFloat((memberCount / familyCount).toFixed(1)) : 0,
      districtStats,
      relationStats
    });
  } catch (err) { next(err); }
});

// POST /admin/family — create family for specific user (admin only)
router.post('/admin/family', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const { ownerId, familyName } = req.body;
    
    if (isFallback()) {
      const existingFamily = memStore.families.find(f => f.owner_id === ownerId);
      if (existingFamily) {
        return success(res, existingFamily);
      }
      
      const newFamily = { 
        id: uuidv4(), 
        owner_id: ownerId, 
        family_name: familyName,
        members: [] 
      };
      memStore.families.push(newFamily);
      return success(res, newFamily, 201);
    }

    // Check if family already exists
    const existingFamily = await query('SELECT * FROM families WHERE owner_id = $1', [ownerId]);
    if (existingFamily.length > 0) {
      return success(res, existingFamily[0]);
    }

    const rows = await query(
      'INSERT INTO families (id, owner_id, family_name) VALUES ($1, $2, $3) RETURNING *',
      [uuidv4(), ownerId, familyName || null]
    );
    success(res, rows[0], 201);
  } catch (err) { next(err); }
});

// POST /admin/member — add member to specific family (admin only)
router.post('/admin/member', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const { familyId, name, relation, age, bloodGroup, mobile } = req.body;
    
    if (isFallback()) {
      const family = memStore.families.find(f => f.id === familyId);
      if (!family) {
        return res.status(404).json({ success: false, error: 'Family not found' });
      }
      
      const member = { 
        id: uuidv4(), 
        name, 
        relation, 
        age: age ?? 0, 
        blood_group: bloodGroup ?? '', 
        mobile: mobile ?? '' 
      };
      family.members.push(member);
      return success(res, member, 201);
    }

    const rows = await query(
      'INSERT INTO family_members (id, family_id, name, relation, age, blood_group, mobile) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [uuidv4(), familyId, name, relation, age ?? null, bloodGroup ?? null, mobile ?? null]
    );
    success(res, rows[0], 201);
  } catch (err) { next(err); }
});

// PUT /admin/member/:id — update family member (admin only)
router.put('/admin/member/:id', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    const { name, relation, age, bloodGroup, mobile } = req.body;
    
    if (isFallback()) {
      let updatedMember = null;
      for (const family of memStore.families) {
        const member = family.members.find(m => m.id === req.params.id);
        if (member) {
          member.name = name ?? member.name;
          member.relation = relation ?? member.relation;
          member.age = age ?? member.age;
          member.blood_group = bloodGroup ?? member.blood_group;
          member.mobile = mobile ?? member.mobile;
          updatedMember = member;
          break;
        }
      }
      return success(res, updatedMember);
    }

    const rows = await query(
      'UPDATE family_members SET name = $1, relation = $2, age = $3, blood_group = $4, mobile = $5 WHERE id = $6 RETURNING *',
      [name, relation, age, bloodGroup, mobile, req.params.id]
    );
    success(res, rows[0]);
  } catch (err) { next(err); }
});

// DELETE /admin/member/:id — delete family member (admin only)
router.delete('/admin/member/:id', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    if (isFallback()) {
      for (const family of memStore.families) {
        const memberIndex = family.members.findIndex(m => m.id === req.params.id);
        if (memberIndex !== -1) {
          family.members.splice(memberIndex, 1);
          break;
        }
      }
      return success(res, { deleted: true });
    }

    await query('DELETE FROM family_members WHERE id = $1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

// DELETE /admin/family/:id — delete entire family (admin only)
router.delete('/admin/family/:id', requireRole('super_admin', 'state_admin', 'district_admin', 'staff'), async (req, res, next) => {
  try {
    if (isFallback()) {
      const familyIndex = memStore.families.findIndex(f => f.id === req.params.id);
      if (familyIndex !== -1) {
        memStore.families.splice(familyIndex, 1);
      }
      return success(res, { deleted: true });
    }

    // Delete family members first, then family (CASCADE should handle this but being explicit)
    await query('DELETE FROM family_members WHERE family_id = $1', [req.params.id]);
    await query('DELETE FROM families WHERE id = $1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

// POST / — add family member
router.post('/', async (req, res, next) => {
  try {
    const { name, relation, age, bloodGroup, mobile } = req.body;
    if (isFallback()) {
      let fam = memStore.families.find(f => f.owner_id === req.user!.userId);
      if (!fam) {
        fam = { id: uuidv4(), owner_id: req.user!.userId, members: [] };
        memStore.families.push(fam);
      }
      const member = { id: uuidv4(), name, relation, age: age ?? 0, blood_group: bloodGroup ?? '', mobile: mobile ?? '' };
      fam.members.push(member);
      return success(res, member, 201);
    }
    let family = await query<{ id: string }>('SELECT id FROM families WHERE owner_id=$1', [req.user!.userId]);
    if (!family.length) {
      family = await query<{ id: string }>('INSERT INTO families (id,owner_id) VALUES ($1,$2) RETURNING id', [uuidv4(), req.user!.userId]);
    }
    const rows = await query('INSERT INTO family_members (id,family_id,name,relation,age,blood_group,mobile) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [uuidv4(), family[0].id, name, relation, age ?? null, bloodGroup ?? null, mobile ?? null]);
    success(res, rows[0], 201);
  } catch (err) { next(err); }
});

// PUT /:id
router.put('/:id', async (req, res, next) => {
  try {
    const { name, relation, age, bloodGroup, mobile } = req.body;
    if (isFallback()) {
      const fam = memStore.families.find(f => f.owner_id === req.user!.userId);
      const member = fam?.members.find(m => m.id === req.params.id);
      if (member) { member.name = name ?? member.name; member.relation = relation ?? member.relation; member.age = age ?? member.age; member.blood_group = bloodGroup ?? member.blood_group; member.mobile = mobile ?? member.mobile; }
      return success(res, member ?? null);
    }
    const rows = await query('UPDATE family_members SET name=$1,relation=$2,age=$3,blood_group=$4,mobile=$5 WHERE id=$6 RETURNING *', [name, relation, age, bloodGroup, mobile, req.params.id]);
    success(res, rows[0]);
  } catch (err) { next(err); }
});

// DELETE /:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (isFallback()) {
      const fam = memStore.families.find(f => f.owner_id === req.user!.userId);
      if (fam) fam.members = fam.members.filter(m => m.id !== req.params.id);
      return success(res, { deleted: true });
    }
    await query('DELETE FROM family_members WHERE id=$1', [req.params.id]);
    success(res, { deleted: true });
  } catch (err) { next(err); }
});

export default router;
