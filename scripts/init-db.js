#!/usr/bin/env node

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initializeDatabase() {
  const client = new pg.Client({
    connectionString: process.env.POSTGRES_URL,
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully!');

    // Read schema file
    const schemaPath = join(__dirname, '../src/infrastructure/database/schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');

    console.log('Executing schema...');
    await client.query(schema);
    console.log('Database schema initialized successfully!');

    // Insert some sample data for testing
    console.log('Inserting sample data...');
    
    // Create a test admin user
    console.log('Creating admin user...');
    await client.query(`
      INSERT INTO users (id, name, mobile, email, role, district, state, is_verified) 
      VALUES ('90ced9cd-52fd-41fd-96ec-ad395e0e702f', 'Admin User', '9999999999', 'admin@ngeo.com', 'super_admin', 'Test District', 'Test State', true)
      ON CONFLICT (mobile) DO UPDATE SET 
        id = '90ced9cd-52fd-41fd-96ec-ad395e0e702f',
        name = 'Admin User',
        role = 'super_admin',
        is_verified = true
    `);

    // Create some test blood donors
    console.log('Creating test users...');
    await client.query(`
      INSERT INTO users (name, mobile, role, blood_group, district, state, is_verified) 
      VALUES 
        ('John Doe', '9876543210', 'user', 'A+', 'Delhi', 'Delhi', true),
        ('Jane Smith', '9876543211', 'user', 'B+', 'Mumbai', 'Maharashtra', true)
      ON CONFLICT (mobile) DO NOTHING
    `);

    // Add them as blood donors
    await client.query(`
      INSERT INTO blood_donors (user_id, blood_group, district, state, is_available)
      SELECT u.id, u.blood_group, u.district, u.state, true
      FROM users u 
      WHERE u.blood_group IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM blood_donors bd WHERE bd.user_id = u.id)
    `);

    // Create some test blood requests
    const testUsers = await client.query(`
      SELECT id FROM users WHERE role = 'user' LIMIT 2
    `);

    if (testUsers.rows.length > 0) {
      await client.query(`
        INSERT INTO blood_requests (requester_id, blood_group, units_needed, hospital_name, district, state, contact_mobile, status)
        VALUES 
          ($1, 'A+', 2, 'Test Hospital', 'Delhi', 'Delhi', '9999999998', 'open'),
          ($2, 'B+', 1, 'City Hospital', 'Mumbai', 'Maharashtra', '9999999997', 'open')
        ON CONFLICT DO NOTHING
      `, [testUsers.rows[0].id, testUsers.rows[1]?.id || testUsers.rows[0].id]);
    }

    console.log('Sample data inserted successfully!');
    
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

initializeDatabase()
  .then(() => {
    console.log('Database initialization completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Initialization failed:', error);
    process.exit(1);
  });