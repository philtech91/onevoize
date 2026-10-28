import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';
import bcrypt from 'bcryptjs';

/** POST /api/admin/users — superadmin creates a new admin user */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const role = body.role;

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'name, email and password are required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters long' },
      { status: 400 },
    );
  }
  if (!['admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 12);
  try {
    const inserted = await db<{ id: number }>(
      'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email, hash, role],
    );
    // Audit log
    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'CREATE_USER', 'users', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        inserted[0]?.id ?? null,
        JSON.stringify({ email, role }),
        getClientIp(request),
      ],
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('unique') || message.includes('duplicate')) {
      return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 });
    }
    console.error('[POST /api/admin/users] Error:', err);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
