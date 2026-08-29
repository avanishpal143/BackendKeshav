import { query, queryOne } from '../../infrastructure/database/postgres.js';

export const userRepository = {
  async findAll(opts: { page: number; limit: number; district?: string; search?: string; role?: string }) {
    const { page, limit, district, search, role } = opts;
    const offset = (page - 1) * limit;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let p = 1;

    if (district) { conditions.push(`district = $${p++}`); params.push(district); }
    if (role) { conditions.push(`role = $${p++}`); params.push(role); }
    if (search) { conditions.push(`(name ILIKE $${p} OR mobile ILIKE $${p} OR member_id ILIKE $${p})`); params.push(`%${search}%`); p++; }

    const where = conditions.join(' AND ');
    const [rows, countRow] = await Promise.all([
      query(`SELECT id,name,mobile,email,role,district,state,blood_group,member_id,is_active,is_verified,created_at
             FROM users WHERE ${where} ORDER BY created_at DESC LIMIT $${p} OFFSET $${p + 1}`,
        [...params, limit, offset]),
      queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM users WHERE ${where}`, params),
    ]);
    return { rows, total: parseInt(countRow?.count ?? '0', 10) };
  },

  async findById(id: string) {
    return queryOne('SELECT * FROM users WHERE id = $1', [id]);
  },

  async update(id: string, data: Record<string, unknown>) {
    const keys = Object.keys(data);
    if (keys.length === 0) return;
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const vals = Object.values(data);
    return query(
      `UPDATE users SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...vals],
    );
  },

  async toggleActive(id: string) {
    return queryOne(
      'UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING id, is_active',
      [id],
    );
  },

  async getStats() {
    const rows = await query<{ role: string; count: string }>(
      `SELECT role, COUNT(*) as count FROM users GROUP BY role`,
    );
    return rows;
  },
};
