import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';
import { ensureMembersSchemaReady } from '@/lib/members-server';

/** GET /api/admin/members/[id] */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await ensureMembersSchemaReady();

  const { id } = await params;
  const rows = await db('SELECT * FROM members WHERE id = $1 LIMIT 1', [Number(id)]);
  if (!rows[0]) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }
  return NextResponse.json({ member: rows[0] });
}

/** PATCH /api/admin/members/[id] — update member profile or status */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await ensureMembersSchemaReady();

  const { id } = await params;
  const memberId = Number(id);
  if (Number.isNaN(memberId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const existingRows = await db('SELECT * FROM members WHERE id = $1 LIMIT 1', [memberId]);
    const existing = existingRows[0];
    if (!existing) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const body = await request.json();
    const full_name =
      body.full_name !== undefined ? String(body.full_name).trim() : String(existing.full_name);
    const email =
      body.email !== undefined ? (body.email ? String(body.email).trim() : null) : existing.email;
    const phone =
      body.phone !== undefined ? (body.phone ? String(body.phone).trim() : null) : existing.phone;
    const address =
      body.address !== undefined
        ? body.address
          ? String(body.address).trim()
          : null
        : existing.address;
    const occupation =
      body.occupation !== undefined
        ? body.occupation
          ? String(body.occupation).trim()
          : null
        : existing.occupation;
    const application_reason =
      body.application_reason !== undefined
        ? body.application_reason
          ? String(body.application_reason).trim()
          : null
        : existing.application_reason;
    const membership_no =
      body.membership_no !== undefined
        ? body.membership_no
          ? String(body.membership_no).trim()
          : null
        : existing.membership_no;
    const status =
      body.status && ['pending', 'active', 'inactive', 'suspended'].includes(body.status)
        ? body.status
        : existing.status;
    const joined_at = body.joined_at || existing.joined_at;
    const notes =
      body.notes !== undefined ? (body.notes ? String(body.notes).trim() : null) : existing.notes;

    if (!full_name) {
      return NextResponse.json({ error: 'Full name cannot be empty' }, { status: 400 });
    }

    const updated = await db(
      `UPDATE members
       SET full_name = $1,
           email = $2,
           phone = $3,
           address = $4,
           occupation = $5,
           application_reason = $6,
           membership_no = $7,
           status = $8,
           joined_at = $9,
           notes = $10,
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        full_name,
        email,
        phone,
        address,
        occupation,
        application_reason,
        membership_no,
        status,
        joined_at,
        notes,
        memberId,
      ],
    );

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'UPDATE_MEMBER', 'members', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        memberId,
        JSON.stringify({ full_name, status, membership_no }),
        getClientIp(request),
      ],
    );

    revalidatePath('/dashboard/members');
    revalidatePath(`/dashboard/members/${memberId}/edit`);
    revalidatePath('/dashboard');

    return NextResponse.json({ success: true, member: updated[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('unique') || message.includes('duplicate')) {
      return NextResponse.json(
        { error: 'A member with that email or membership number already exists' },
        { status: 409 },
      );
    }
    console.error('[PATCH /api/admin/members/[id]] Error:', err);
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
}

/** DELETE /api/admin/members/[id] */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await ensureMembersSchemaReady();

  const { id } = await params;
  const memberId = Number(id);
  const deleted = await db('DELETE FROM members WHERE id = $1 RETURNING id, full_name', [
    memberId,
  ]);
  if (!deleted[0]) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  await db(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
     VALUES ($1, 'DELETE_MEMBER', 'members', $2, $3, $4)`,
    [Number(session.user.id) || null, memberId, JSON.stringify(deleted[0]), getClientIp(request)],
  );

  revalidatePath('/dashboard/members');
  revalidatePath('/dashboard');

  return NextResponse.json({ success: true });
}
