import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';
import { ensureMembersSchemaReady } from '@/lib/members-server';

/** GET /api/admin/members */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await ensureMembersSchemaReady();
  const rows = await db('SELECT * FROM members ORDER BY joined_at DESC, id DESC');
  return NextResponse.json({ members: rows });
}

/** POST /api/admin/members — create a new club member */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  await ensureMembersSchemaReady();

  try {
    const body = await request.json();
    const full_name = String(body.full_name || '').trim();
    const email = body.email ? String(body.email).trim() : null;
    const phone = body.phone ? String(body.phone).trim() : null;
    const address = body.address ? String(body.address).trim() : null;
    const occupation = body.occupation ? String(body.occupation).trim() : null;
    const application_reason = body.application_reason
      ? String(body.application_reason).trim()
      : null;
    let membership_no = body.membership_no ? String(body.membership_no).trim() : null;
    const status = ['pending', 'active', 'inactive', 'suspended'].includes(body.status)
      ? body.status
      : 'active';
    const joined_at = body.joined_at || new Date().toISOString().split('T')[0];
    const notes = body.notes ? String(body.notes).trim() : null;

    if (!full_name) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }

    if (!membership_no) {
      const year = new Date().getFullYear();
      const token = crypto.randomBytes(4).toString('hex').toUpperCase();
      membership_no = `OVC-${year}-${token}`;
    }

    const rows = await db(
      `INSERT INTO members (full_name, email, phone, address, occupation, application_reason, membership_no, status, joined_at, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
      ],
    );

    const member = rows[0];

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'CREATE_MEMBER', 'members', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        member?.id ?? null,
        JSON.stringify({ full_name, email, membership_no, status }),
        getClientIp(request),
      ],
    );

    revalidatePath('/dashboard/members');
    revalidatePath('/dashboard');

    return NextResponse.json({ success: true, member });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('unique') || message.includes('duplicate')) {
      return NextResponse.json(
        { error: 'A member with that email or membership number already exists' },
        { status: 409 },
      );
    }
    console.error('[POST /api/admin/members] Error:', err);
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 });
  }
}
