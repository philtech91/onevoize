/**
 * Setup Neon Database Schema & Seed Initial Superadmin
 *
 * Usage:
 *   node scripts/setup-db.mjs
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
  process.exit(1);
}

// Ensure quotes are cleanly stripped
DATABASE_URL = DATABASE_URL.trim().replace(/^['"]|['"]$/g, '');

const { default: bcrypt } = await import('bcryptjs');
const { neon } = await import('@neondatabase/serverless');
const sql = neon(DATABASE_URL);

console.log('🔗  Connected to Neon DB endpoint...');

// ─── 1. Run Schema ────────────────────────────────────────────────────────────
console.log('📦  Initializing database schema...');
const schemaPath = resolve(__dir, '../src/lib/schema.sql');
let schemaSql = readFileSync(schemaPath, 'utf8');

// Strip single-line comments (-- ...) and split by semicolon
const cleanedSql = schemaSql.replace(/--.*$/gm, '');
const statements = cleanedSql
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const stmt of statements) {
  try {
    await sql.query(stmt);
  } catch (err) {
    console.error(`⚠️  Warning on statement:`, stmt.substring(0, 60), `... Error:`, err?.message || err);
  }
}
try {
  await sql.query('ALTER TABLE members ADD COLUMN IF NOT EXISTS occupation TEXT');
  await sql.query('ALTER TABLE members ADD COLUMN IF NOT EXISTS application_reason TEXT');
  await sql.query('ALTER TABLE members DROP CONSTRAINT IF EXISTS members_status_check');
  await sql.query(
    "ALTER TABLE members ADD CONSTRAINT members_status_check CHECK (status IN ('pending','active','inactive','suspended'))",
  );
} catch (err) {
  console.error('⚠️  Warning updating members constraint:', err?.message || err);
}
console.log('✅  Schema initialized successfully!');

// ─── 2. Seed Superadmin ───────────────────────────────────────────────────────
const NAME = (process.env.SUPERADMIN_NAME || 'Super Admin').trim();
const EMAIL = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
const PASSWORD = process.env.SUPERADMIN_PASSWORD || '';
const ROLE = 'superadmin';

if (EMAIL && PASSWORD) {
  if (PASSWORD.length < 8) {
    console.error('❌  SUPERADMIN_PASSWORD must be at least 8 characters long.');
    process.exit(1);
  }
  console.log(`\n🌱  Seeding superadmin: ${EMAIL} …`);
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

  console.log('✅  Superadmin created/updated successfully!');
  console.log(`   Email    : ${EMAIL}`);
  console.log(`   Role     : ${ROLE}`);
} else {
  console.log('\nℹ️  Skipping superadmin seed (set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD in .env.local to seed).');
}

// ─── 3. Seed Initial Campaigns & Events if empty ─────────────────────────────
try {
  const existingCampaigns = await sql.query('SELECT count(*)::int as count FROM campaigns');
  if (existingCampaigns[0]?.count === 0) {
    console.log('\n🌱  Seeding initial community campaigns...');
    await sql.query(`
      INSERT INTO campaigns (title, slug, description, goal_amount, raised_amount, status)
      VALUES 
        ('Lagos Youth Digital Literacy Drive', 'lagos-youth-digital-literacy', 'Equipping 500 underprivileged youth with laptops and software training in web development and data skills.', 5000000, 3250000, 'active'),
        ('Community Healthcare & Elders Outreach', 'community-healthcare-outreach', 'Providing free basic medical checkups, vital medicines, and eyeglasses for elderly residents in Lagos.', 3000000, 1850000, 'active'),
        ('Back-to-School Educational Supplies', 'back-to-school-supplies', 'Distributing school bags, notebooks, and uniforms to 1,000 primary school pupils across public schools.', 2000000, 1420000, 'active')
    `);
    console.log('✅  Sample campaigns seeded.');
  }

  const existingEvents = await sql.query('SELECT count(*)::int as count FROM events');
  if (existingEvents[0]?.count === 0) {
    console.log('🌱  Seeding upcoming club events...');
    await sql.query(`
      INSERT INTO events (title, description, location, event_date, status, max_attendees)
      VALUES 
        ('Annual Lagos Charity Gala & Awards 2026', 'A prestigious evening celebrating club milestones, honoring community heroes, and fundraising for our educational scholarship fund.', 'Eko Hotels & Suites, Victoria Island, Lagos', NOW() + INTERVAL '28 days', 'upcoming', 250),
        ('Quarterly Youth Mentorship Bootcamp', 'Interactive mentoring session pairing young professionals with secondary and tertiary students across tech and business.', 'ONE VOIZE Community Hub, Surulere, Lagos', NOW() + INTERVAL '14 days', 'upcoming', 100),
        ('Clean Green Lagos Walk & Tree Planting', 'Community environmental sanitation exercise and tree planting across key public recreation spaces.', 'Ndubuisi Kanu Park, Alausa, Ikeja, Lagos', NOW() + INTERVAL '45 days', 'upcoming', 150)
    `);
    console.log('✅  Sample events seeded.');
  }

  const existingGallery = await sql.query('SELECT count(*)::int as count FROM gallery_items');
  if (existingGallery[0]?.count === 0) {
    console.log('🌱  Seeding initial club gallery photos and videos...');
    await sql.query(`
      INSERT INTO gallery_items (media_type, src, title, caption, alt_text, category, display_order, is_published)
      VALUES
        ('image', '/images/club/gvc-at-mother-less-home-in-surulere.jpeg', 'Charity Outreach at Motherless Home in Surulere', 'Gvc at mother less home in surulere for Charity Donation towards our first year anniversary', 'Gvc at mother less home in surulere for Charity Donation towards our first year anniversary', 'outreach', 1, TRUE),
        ('image', '/images/club/members-at-event.jpeg', 'Members on the Green Carpet', 'Three club members in white polo shirts on a green carpet in front of the Global Voize anniversary banner', 'Three club members in white polo shirts on a green carpet in front of the Global Voize anniversary banner', 'events', 2, TRUE),
        ('image', '/images/club/Hon%20Prince%20Adeyeye%20and%20Hon%20Prince%20Adeniyi%20at%20a%20party%20represent%20GVC.jpeg', 'Hon. Prince Adeyeye & Hon. Prince Adeniyi Representing GVC', 'Global Voize Club representatives Hon. Prince Adeyeye and Hon. Prince Adeniyi at a party', 'Global Voize Club representatives Hon. Prince Adeyeye and Hon. Prince Adeniyi at a party', 'club', 3, TRUE),
        ('image', '/images/club/Hon%20Prince%20Adeyeye%20and%20Hon%20Prince%20Adeniyi%20at%20a%20party%20represent.jpeg', 'Club Representatives at Celebration', 'Hon. Prince Adeyeye and Hon. Prince Adeniyi representing Global Voize Club at a party', 'Hon. Prince Adeyeye and Hon. Prince Adeniyi representing Global Voize Club at a party', 'club', 4, TRUE),
        ('image', '/images/club/club-celebration.jpeg', 'Club Celebration Gathering', 'A club member wearing a blue club sash and traditional cap among guests dressed in white lace at a celebration', 'A club member wearing a blue club sash and traditional cap among guests dressed in white lace at a celebration', 'celebration', 5, TRUE),
        ('image', '/images/club/members-group.jpeg', 'Outreach Visit Group Portrait', 'Club members in matching white polo shirts lined up outside a care centre during an outreach visit', 'Club members in matching white polo shirts lined up outside a care centre during an outreach visit', 'outreach', 6, TRUE),
        ('image', '/images/club/club-leaders.jpeg', 'Club Leaders at Welcome Banner', 'Three club members in white polo shirts holding bottled water in front of the Global Voize welcome banner', 'Three club members in white polo shirts holding bottled water in front of the Global Voize welcome banner', 'club', 7, TRUE),
        ('video', '/images/club/event-setup.mp4', 'Anniversary preparations', 'Awogbadebo Alabi Mobolaji, General Secretary, during preparations for the club''s first anniversary celebration.', 'Anniversary preparations', 'events', 8, TRUE),
        ('video', '/images/club/event.mp4', 'Club event', 'Members and guests at a club gathering.', 'Club event', 'events', 9, TRUE),
        ('video', '/images/club/events.mp4', 'Club events', 'Highlights from club outings and gatherings.', 'Club events', 'events', 10, TRUE),
        ('video', '/images/club/k1-wasiu.mp4', 'Meeting K1 De Ultimate', 'Sunday Olufemi Jeje introduces the club to King Wasiu Ayinde Marshal (K1 De Ultimate) at an event.', 'Meeting K1 De Ultimate', 'events', 11, TRUE)
    `);
    console.log('✅  Initial gallery photos & videos seeded.');
  }
} catch (err) {
  console.log('⚠️  Could not seed sample campaigns/events/gallery (optional):', err?.message);
}

console.log('\n🎉  Database setup complete! You can sign in at: /dashboard/login\n');

