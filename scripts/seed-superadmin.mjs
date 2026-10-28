/**
 * Seed the first superadmin account into Neon DB.
 *
 * Usage:
 *   node scripts/seed-superadmin.mjs
 *
 * Reads DATABASE_URL or POSTGRES_URL from .env.local automatically.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Load .env.local ────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, '../.env.local');
const envContent = readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    let val = match[2].trim();
    // Strip wrapping single or double quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[match[1].trim()] = val;
  }
}

let DATABASE_URL =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!DATABASE_URL || DATABASE_URL.includes('user:password@ep-xxx')) {
  console.error('\n❌  No active database connection string found in .env.local');
  console.error('   Please ensure DATABASE_URL or POSTGRES_URL is set in .env.local.\n');
  process.exit(1);
}

// Ensure any residual quotes are cleanly stripped
DATABASE_URL = DATABASE_URL.trim().replace(/^['"]|['"]$/g, '');

// ─── bcrypt ──────────────────────────────────────────────────────────────────
const { default: bcrypt } = await import('bcryptjs');

// ─── Neon DB ─────────────────────────────────────────────────────────────────
const { neon } = await import('@neondatabase/serverless');
const sql = neon(DATABASE_URL);

// ─── Superadmin credentials ──────────────────────────────────────────────────
const NAME     = (process.env.SUPERADMIN_NAME || 'Super Admin').trim();
const EMAIL    = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
const PASSWORD = process.env.SUPERADMIN_PASSWORD || '';
const ROLE     = 'superadmin';

if (!EMAIL || !PASSWORD) {
  console.error('\n❌  Missing SUPERADMIN_EMAIL or SUPERADMIN_PASSWORD in .env.local');
  console.error('   Please set both environment variables before running this script.\n');
  process.exit(1);
}

if (PASSWORD.length < 8) {
  console.error('\n❌  SUPERADMIN_PASSWORD must be at least 8 characters long.\n');
  process.exit(1);
}

// ─── Run ─────────────────────────────────────────────────────────────────────
console.log(`\n🌱  Seeding superadmin: ${EMAIL} …`);

try {
  const hash = await bcrypt.hash(PASSWORD, 12);

  await sql.query(
    `INSERT INTO users (name, email, password, role, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (email) DO UPDATE
       SET password  = EXCLUDED.password,
           role      = EXCLUDED.role,
           is_active = TRUE,
           updated_at = NOW()`,
    [NAME, EMAIL, hash, ROLE],
  );

  console.log('✅  Superadmin seeded successfully!');
  console.log(`   Email : ${EMAIL}`);
  console.log(`   Role  : ${ROLE}`);
  console.log(`\n   👉  Sign in at: http://localhost:3000/dashboard/login\n`);
} catch (err) {
  if (err && typeof err === 'object' && 'message' in err && String(err.message).includes('relation "users" does not exist')) {
    console.error('\n❌  The "users" table does not exist in your Neon database yet.');
    console.error('   Please run the SQL schema in your Neon console first:');
    console.error('   File: src/lib/schema.sql\n');
  } else {
    console.error('\n❌  Seeding error:', err);
  }
  process.exit(1);
}
