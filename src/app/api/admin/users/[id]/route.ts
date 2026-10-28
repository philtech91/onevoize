import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';

/** GET /api/admin/users/[id] */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const rows = await db(
    'SELECT id, name, email, role, is_active, created_at, updated_at FROM users WHERE id = $1 LIMIT 1',
    [Number(id)],
  );
  if (!rows[0]) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  return NextResponse.json({ user: rows[0] });
}

/** PATCH /api/admin/users/[id] — superadmin updates user profile, role, active state, or password */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const userId = Number(id);
  if (Number.isNaN(userId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const existingRows = await db('SELECT * FROM users WHERE id = $1 LIMIT 1', [userId]);
    const existing = existingRows[0];
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await request.json();
    const name = body.name !== undefined ? String(body.name).trim() : String(existing.name);
    const email = body.email !== undefined ? String(body.email).trim().toLowerCase() : String(existing.email);
    const role = body.role && ['admin', 'superadmin'].includes(body.role)
      ? body.role
      : existing.role;
    const is_active = typeof body.is_active === 'boolean' ? body.is_active : Boolean(existing.is_active);

    if (userId === Number(session.user.id) && !is_active) {
      return NextResponse.json({ error: 'You cannot disable your own account' }, { status: 400 });
    }

    let passwordHash = String(existing.password);
    if (body.password && String(body.password).trim().length > 0) {
      const nextPassword = String(body.password).trim();
      if (nextPassword.length < 8) {
        return NextResponse.json(
          { error: 'Password must be at least 8 characters long' },
          { status: 400 },
        );
      }
      passwordHash = await bcrypt.hash(nextPassword, 12);
    }

    const updated = await db(
      `UPDATE users
       SET name = $1,
           email = $2,
           role = $3,
           is_active = $4,
           password = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, email, role, is_active, created_at, updated_at`,
      [name, email, role, is_active, passwordHash, userId],
    );

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'UPDATE_USER', 'users', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        userId,
        JSON.stringify({ name, email, role, is_active, passwordReset: Boolean(body.password) }),
        getClientIp(request),
      ],
    );

    revalidatePath('/dashboard/superadmin/users');
    revalidatePath(`/dashboard/superadmin/users/${userId}/edit`);

    return NextResponse.json({ success: true, user: updated[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('unique') || message.includes('duplicate')) {
      return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 });
    }
    console.error('[PATCH /api/admin/users/[id]] Error:', err);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

/** DELETE /api/admin/users/[id] */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const userId = Number(id);
  if (userId === Number(session.user.id)) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
  }

  const deleted = await db('DELETE FROM users WHERE id = $1 RETURNING id, name, email', [userId]);
  if (!deleted[0]) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  await db(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
     VALUES ($1, 'DELETE_USER', 'users', $2, $3, $4)`,
    [Number(session.user.id) || null, userId, JSON.stringify(deleted[0]), getClientIp(request)],
  );

  revalidatePath('/dashboard/superadmin/users');

  return NextResponse.json({ success: true });
}
