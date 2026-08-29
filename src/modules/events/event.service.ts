import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../../infrastructure/database/postgres.js';
import { memStore } from '../../infrastructure/database/memoryStore.js';
import { isFallback } from '../../shared/dbHelper.js';
import { logger } from '../../shared/logger.js';

interface EventData {
  title: string;
  description: string;
  venue: string;
  address?: string;
  district: string;
  state: string;
  category: string;
  type?: string;
  maxCapacity?: number;
  registrationRequired?: boolean;
  imageUrl?: string;
  videoUrl?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  tags?: string[];
  startsAt: string;
  endsAt?: string;
  registrationDeadline?: string;
  latitude?: number;
  longitude?: number;
  organizerId: string;
}

interface RegistrationData {
  name: string;
  mobile: string;
  email?: string;
  familyMembersCount?: number;
  userId?: string | null;
}

export const eventService = {
  async getEvents(filters: {
    page: number;
    limit: number;
    search?: string;
    category?: string;
    district?: string;
    state?: string;
    type?: string;
    upcoming?: boolean;
  }) {
    const { page, limit, search, category, district, state, type, upcoming } = filters;
    const offset = (page - 1) * limit;

    if (isFallback()) {
      let events = [...memStore.events].filter(e => e.is_active);
      
      // Apply filters
      if (search) {
        const searchLower = search.toLowerCase();
        events = events.filter(e => 
          e.title.toLowerCase().includes(searchLower) ||
          e.description.toLowerCase().includes(searchLower)
        );
      }
      if (category) events = events.filter(e => e.category === category);
      if (district) events = events.filter(e => e.district === district);
      if (state) events = events.filter(e => e.state === state);
      if (upcoming) {
        const now = new Date();
        events = events.filter(e => new Date(e.starts_at) >= now);
      }

      events.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());

      const total = events.length;
      const data = events.slice(offset, offset + limit);

      return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
    }

    // Database implementation
    const conditions: string[] = ['e.is_active = true'];
    const params: any[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(e.title ILIKE $${paramIndex} OR e.description ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }
    if (category) {
      conditions.push(`e.category = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }
    if (district) {
      conditions.push(`e.district = $${paramIndex}`);
      params.push(district);
      paramIndex++;
    }
    if (state) {
      conditions.push(`e.state = $${paramIndex}`);
      params.push(state);
      paramIndex++;
    }
    if (type) {
      conditions.push(`e.type = $${paramIndex}`);
      params.push(type);
      paramIndex++;
    }
    if (upcoming) {
      conditions.push('e.starts_at >= NOW()');
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    
    const countQuery = `SELECT COUNT(*) as count FROM events e ${whereClause}`;
    const totalResult = await queryOne<{ count: string }>(countQuery, params);
    const total = parseInt(totalResult?.count || '0');

    const eventsQuery = `
      SELECT e.*, u.name as organizer_name
      FROM events e 
      LEFT JOIN users u ON e.organizer_id = u.id 
      ${whereClause}
      ORDER BY e.starts_at ASC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const data = await query(eventsQuery, params);

    return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
  },

  async getEventById(id: string) {
    if (isFallback()) {
      const event = memStore.events.find(e => e.id === id && e.is_active);
      if (!event) return null;
      
      // Add registration count (mock)
      return { ...event, registrations_count: 0 };
    }

    const eventQuery = `
      SELECT e.*, u.name as organizer_name
      FROM events e 
      LEFT JOIN users u ON e.organizer_id = u.id 
      WHERE e.id = $1 AND e.is_active = true
    `;
    
    return await queryOne(eventQuery, [id]);
  },

  async createEvent(data: EventData) {
    const id = uuidv4();
    const now = new Date().toISOString();

    if (isFallback()) {
      const event = {
        id,
        title: data.title,
        description: data.description,
        venue: data.venue,
        address: data.address || null,
        district: data.district,
        state: data.state,
        category: data.category,
        type: data.type || 'free',
        max_capacity: data.maxCapacity || null,
        registration_required: data.registrationRequired || false,
        image_url: data.imageUrl || null,
        video_url: data.videoUrl || null,
        contact_name: data.contactName || null,
        contact_phone: data.contactPhone || null,
        contact_email: data.contactEmail || null,
        tags: data.tags?.join(',') || null,
        starts_at: data.startsAt,
        ends_at: data.endsAt || null,
        registration_deadline: data.registrationDeadline || null,
        latitude: data.latitude || null,
        longitude: data.longitude || null,
        organizer_id: data.organizerId,
        is_active: true,
        created_at: now,
      };
      
      memStore.events.push(event);
      return event;
    }

    const insertQuery = `
      INSERT INTO events (
        id, title, description, venue, address, district, state, category, type,
        max_capacity, registration_required, image_url, video_url,
        contact_name, contact_phone, contact_email, tags,
        starts_at, ends_at, registration_deadline, latitude, longitude,
        organizer_id, is_active, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22, $23, $24, $25
      ) RETURNING *
    `;

    return await queryOne(insertQuery, [
      id, data.title, data.description, data.venue, data.address,
      data.district, data.state, data.category, data.type || 'free',
      data.maxCapacity, data.registrationRequired || false,
      data.imageUrl, data.videoUrl, data.contactName, data.contactPhone, data.contactEmail,
      data.tags?.join(','), data.startsAt, data.endsAt, data.registrationDeadline,
      data.latitude, data.longitude, data.organizerId, true, now
    ]);
  },

  async registerForEvent(eventId: string, data: RegistrationData) {
    const id = uuidv4();
    const now = new Date().toISOString();

    if (isFallback()) {
      // Mock registration for memory store
      return {
        id,
        event_id: eventId,
        user_id: data.userId,
        name: data.name,
        mobile: data.mobile,
        email: data.email,
        family_members_count: data.familyMembersCount || 1,
        status: 'confirmed',
        registered_at: now,
      };
    }

    const insertQuery = `
      INSERT INTO event_registrations (
        id, event_id, user_id, name, mobile, email, family_members_count, status, registered_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    return await queryOne(insertQuery, [
      id, eventId, data.userId, data.name, data.mobile, data.email,
      data.familyMembersCount || 1, 'confirmed', now
    ]);
  },

  async updateEvent(id: string, data: Partial<EventData>) {
    const now = new Date().toISOString();

    if (isFallback()) {
      const index = memStore.events.findIndex(e => e.id === id);
      if (index === -1) return null;

      const event = memStore.events[index];
      memStore.events[index] = {
        ...event,
        title: data.title ?? event.title,
        description: data.description ?? event.description,
        venue: data.venue ?? event.venue,
        address: data.address ?? event.address,
        district: data.district ?? event.district,
        state: data.state ?? event.state,
        category: data.category ?? event.category,
        type: data.type ?? event.type,
        max_capacity: data.maxCapacity ?? event.max_capacity,
        registration_required: data.registrationRequired ?? event.registration_required,
        image_url: data.imageUrl ?? event.image_url,
        contact_name: data.contactName ?? event.contact_name,
        contact_phone: data.contactPhone ?? event.contact_phone,
        starts_at: data.startsAt ?? event.starts_at,
        ends_at: data.endsAt ?? event.ends_at,
        updated_at: now,
      };
      return memStore.events[index];
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        const dbKey = key === 'imageUrl' ? 'image_url' : 
                     key === 'videoUrl' ? 'video_url' : 
                     key === 'maxCapacity' ? 'max_capacity' :
                     key === 'registrationRequired' ? 'registration_required' :
                     key === 'contactName' ? 'contact_name' :
                     key === 'contactPhone' ? 'contact_phone' :
                     key === 'contactEmail' ? 'contact_email' :
                     key === 'startsAt' ? 'starts_at' :
                     key === 'endsAt' ? 'ends_at' :
                     key === 'registrationDeadline' ? 'registration_deadline' :
                     key === 'organizerId' ? 'organizer_id' : key;
        
        updates.push(`${dbKey} = $${paramIndex}`);
        params.push(Array.isArray(value) ? value.join(',') : value);
        paramIndex++;
      }
    });

    if (updates.length === 0) return null;

    updates.push(`updated_at = $${paramIndex}`);
    params.push(now);
    params.push(id);

    const updateQuery = `UPDATE events SET ${updates.join(', ')} WHERE id = $${paramIndex + 1} RETURNING *`;
    return await queryOne(updateQuery, params);
  },

  async deleteEvent(id: string) {
    if (isFallback()) {
      const index = memStore.events.findIndex(e => e.id === id);
      if (index !== -1) memStore.events.splice(index, 1);
      return;
    }

    await query('DELETE FROM events WHERE id = $1', [id]);
  },

  async toggleActive(id: string, isActive: boolean) {
    const now = new Date().toISOString();

    if (isFallback()) {
      const index = memStore.events.findIndex(e => e.id === id);
      if (index === -1) return null;

      memStore.events[index] = { ...memStore.events[index], is_active: isActive, updated_at: now };
      return memStore.events[index];
    }

    const updateQuery = `UPDATE events SET is_active = $1, updated_at = $2 WHERE id = $3 RETURNING *`;
    return await queryOne(updateQuery, [isActive, now, id]);
  },

  async getAdminEvents(filters: { page: number; limit: number; status?: string }) {
    const { page, limit, status } = filters;
    const offset = (page - 1) * limit;

    if (isFallback()) {
      let events = [...memStore.events];
      
      if (status === 'active') events = events.filter(e => e.is_active);
      if (status === 'inactive') events = events.filter(e => !e.is_active);

      events.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const total = events.length;
      const data = events.slice(offset, offset + limit);

      return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
    }

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (status === 'active') conditions.push('is_active = true');
    if (status === 'inactive') conditions.push('is_active = false');

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const countQuery = `SELECT COUNT(*) as count FROM events ${whereClause}`;
    const totalResult = await queryOne<{ count: string }>(countQuery, params);
    const total = parseInt(totalResult?.count || '0');

    const eventsQuery = `
      SELECT e.*, u.name as organizer_name
      FROM events e 
      LEFT JOIN users u ON e.organizer_id = u.id 
      ${whereClause}
      ORDER BY e.created_at DESC 
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const data = await query(eventsQuery, params);
    return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
  },

  async getEventRegistrations(eventId: string, page: number, limit: number) {
    const offset = (page - 1) * limit;

    if (isFallback()) {
      // Mock data for memory store
      return { 
        data: [], 
        pagination: { total: 0, page, limit, pages: 0 } 
      };
    }

    const countQuery = `SELECT COUNT(*) as count FROM event_registrations WHERE event_id = $1`;
    const totalResult = await queryOne<{ count: string }>(countQuery, [eventId]);
    const total = parseInt(totalResult?.count || '0');

    const registrationsQuery = `
      SELECT er.*, u.name as user_name 
      FROM event_registrations er 
      LEFT JOIN users u ON er.user_id = u.id 
      WHERE er.event_id = $1 
      ORDER BY er.registered_at DESC 
      LIMIT $2 OFFSET $3
    `;

    const data = await query(registrationsQuery, [eventId, limit, offset]);
    return { data, pagination: { total, page, limit, pages: Math.ceil(total / limit) } };
  },

  async getNearbyEvents(latitude: number, longitude: number, radius: number) {
    if (isFallback()) {
      // Simple distance calculation for memory store
      return memStore.events.filter(e => e.is_active).slice(0, 10);
    }

    // Using PostGIS for location queries
    const query_text = `
      SELECT *, 
        ST_Distance(
          ST_Point(longitude, latitude)::geography,
          ST_Point($2, $1)::geography
        ) / 1000 as distance_km
      FROM events 
      WHERE is_active = true 
        AND latitude IS NOT NULL 
        AND longitude IS NOT NULL
        AND ST_DWithin(
          ST_Point(longitude, latitude)::geography,
          ST_Point($2, $1)::geography,
          $3 * 1000
        )
      ORDER BY distance_km ASC
      LIMIT 20
    `;

    return await query(query_text, [latitude, longitude, radius]);
  },

  async getCalendarEvents(startDate: string, endDate: string) {
    if (isFallback()) {
      return memStore.events.filter(e => 
        e.is_active && 
        e.starts_at >= startDate && 
        e.starts_at <= endDate
      );
    }

    const query_text = `
      SELECT id, title, starts_at, ends_at, category, district, state
      FROM events 
      WHERE is_active = true 
        AND starts_at >= $1 
        AND starts_at <= $2
      ORDER BY starts_at ASC
    `;

    return await query(query_text, [startDate, endDate]);
  },
};