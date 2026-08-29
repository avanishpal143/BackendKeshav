import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { v4 as uuidv4 } from 'uuid';

export const familyRepository = {
  async getOrCreateFamily(ownerId: string) {
    let family = await queryOne<{ id: string }>(
      'SELECT id FROM families WHERE owner_id = $1',
      [ownerId],
    );
    if (!family) {
      const rows = await query<{ id: string }>(
        'INSERT INTO families (id, owner_id) VALUES ($1,$2) RETURNING id',
        [uuidv4(), ownerId],
      );
      family = rows[0];
    }
    return family;
  },

  async getMembers(ownerId: string) {
    return query(
      `SELECT fm.* FROM family_members fm
       JOIN families f ON fm.family_id = f.id
       WHERE f.owner_id = $1 ORDER BY fm.created_at`,
      [ownerId],
    );
  },

  async addMember(ownerId: string, data: {
    name: string; relation: string; age?: number;
    bloodGroup?: string; mobile?: string;
  }) {
    const family = await this.getOrCreateFamily(ownerId);
    const rows = await query(
      `INSERT INTO family_members (id, family_id, name, relation, age, blood_group, mobile)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [uuidv4(), family.id, data.name, data.relation, data.age ?? null,
       data.bloodGroup ?? null, data.mobile ?? null],
    );
    return rows[0];
  },

  async updateMember(memberId: string, ownerId: string, data: Record<string, unknown>) {
    const keys = Object.keys(data);
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const rows = await query(
      `UPDATE family_members fm SET ${sets}
       FROM families f WHERE fm.id = $1 AND fm.family_id = f.id AND f.owner_id = $2 RETURNING fm.*`,
      [memberId, ownerId, ...Object.values(data)],
    );
    return rows[0];
  },

  async deleteMember(memberId: string, ownerId: string) {
    await query(
      `DELETE FROM family_members fm USING families f
       WHERE fm.id = $1 AND fm.family_id = f.id AND f.owner_id = $2`,
      [memberId, ownerId],
    );
  },
};
