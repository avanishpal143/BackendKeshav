import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { v4 as uuidv4 } from 'uuid';

export interface UserRecord {
  id: string;
  name: string;
  mobile: string;
  email?: string;
  google_id?: string;
  avatar_url?: string;
  role: string;
  blood_group?: string;
  district?: string;
  state?: string;
  member_id?: string;
  is_active: boolean;
  is_verified: boolean;
  created_at: Date;
}

export const authRepository = {
  async findByEmail(email: string): Promise<UserRecord | null> {
    return queryOne<UserRecord>('SELECT * FROM users WHERE email = $1', [email]);
  },

  async findByMobile(mobile: string): Promise<UserRecord | null> {
    return queryOne<UserRecord>(
      'SELECT * FROM users WHERE mobile = $1',
      [mobile],
    );
  },

  async findById(id: string): Promise<UserRecord | null> {
    return queryOne<UserRecord>(
      'SELECT * FROM users WHERE id = $1',
      [id],
    );
  },

  async findByGoogleId(googleId: string): Promise<UserRecord | null> {
    return queryOne<UserRecord>(
      'SELECT * FROM users WHERE google_id = $1',
      [googleId],
    );
  },

  async createUser(data: {
    name: string;
    mobile: string;
    email?: string;
    googleId?: string;
    role?: string;
    district?: string;
    state?: string;
    bloodGroup?: string;
    isVerified?: boolean;
  }): Promise<UserRecord> {
    const memberId = `CC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const rows = await query<UserRecord>(
      `INSERT INTO users (id, name, mobile, email, google_id, role, district, state, blood_group, member_id, is_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        uuidv4(),
        data.name,
        data.mobile,
        data.email ?? null,
        data.googleId ?? null,
        data.role ?? 'user',
        data.district ?? null,
        data.state ?? null,
        data.bloodGroup ?? null,
        memberId,
        data.isVerified ?? false,
      ],
    );
    return rows[0];
  },

  async updateLastSeen(userId: string): Promise<void> {
    await query(
      'UPDATE users SET last_seen_at = NOW() WHERE id = $1',
      [userId],
    );
  },

  async saveRefreshToken(userId: string, token: string, expiresAt: Date): Promise<void> {
    await query(
      `INSERT INTO refresh_tokens (id, user_id, token, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [uuidv4(), userId, token, expiresAt],
    );
  },

  async findRefreshToken(token: string): Promise<{ user_id: string; expires_at: Date } | null> {
    return queryOne<{ user_id: string; expires_at: Date }>(
      'SELECT user_id, expires_at FROM refresh_tokens WHERE token = $1',
      [token],
    );
  },

  async deleteRefreshToken(token: string): Promise<void> {
    await query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
  },

  async updateFcmToken(userId: string, fcmToken: string): Promise<void> {
    await query(
      'UPDATE users SET fcm_token = $1 WHERE id = $2',
      [fcmToken, userId],
    );
  },
};
