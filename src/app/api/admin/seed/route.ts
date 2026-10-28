import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { db, getClientIp } from '@/lib/db';
import bcrypt from 'bcryptjs';

function safeCompareSecret(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * POST /api/admin/seed
 * One-time endpoint to create the first superadmin.
 * Requires SEED_SECRET header matching SEED_SECRET env var, and refuses to run
 * once a superadmin account already exists in the database.
 */
export async function POST(request: Request) {
  const seedSecret = process.env.SEED_SECRET;
  if (!seedSecret) {
    return NextResponse.json({ error: 'SEED_SECRET not configured' }, { status: 500 });
  }
  const authHeader = request.headers.get('x-seed-secret') || '';
  if (!authHeader || !safeCompareSecret(authHeader, seedSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const existingSuperadmins = await db<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM users WHERE role = 'superadmin'",
  );
  if ((existingSuperadmins[0]?.count ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Initial superadmin has already been seeded. Endpoint is locked.' },
      { status: 403 },
    );
  }

  const body = await request.json();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'name, email and password are required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters long' },
      { status: 400 },
    );
  }

  const hash = await bcrypt.hash(password, 12);
  const inserted = await db<{ id: number }>(
    `INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'superadmin')
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [name, email, hash],
  );

  await db(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
     VALUES ($1, 'SEED_SUPERADMIN', 'users', $2, $3, $4)`,
    [
      inserted[0]?.id ?? null,
      inserted[0]?.id ?? null,
      JSON.stringify({ email, role: 'superadmin' }),
      getClientIp(request),
    ],
  );

  return NextResponse.json({ success: true, message: 'Superadmin created.' });
}
