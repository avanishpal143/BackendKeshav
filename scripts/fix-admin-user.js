#!/usr/bin/env node

import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function fixAdminUser() {
  const client = new pg.Client({
    connectionString: process.env.POSTGRES_URL,
  });

  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('Connected successfully!');

    // Update/create admin user with the correct UUID from the JWT token
    console.log('Creating/updating admin user...');
    await client.query(`
      INSERT INTO users (id, name, mobile, email, role, district, state, is_verified) 
      VALUES ('90ced9cd-52fd-41fd-96ec-ad395e0e702f', 'Admin User', '9999999999', 'admin@ngeo.com', 'super_admin', 'Test District', 'Test State', true)
      ON CONFLICT (mobile) DO UPDATE SET 
        id = '90ced9cd-52fd-41fd-96ec-ad395e0e702f',
        name = 'Admin User',
        role = 'super_admin',
        is_verified = true
    `);

    console.log('Admin user created/updated successfully!');
    
  } catch (error) {
    console.error('Failed to fix admin user:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

fixAdminUser()
  .then(() => {
    console.log('Admin user fix completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fix failed:', error);
    process.exit(1);
  });