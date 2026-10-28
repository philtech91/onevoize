import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';
import { isSafeMediaSrc } from '@/lib/gallery-server';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** GET /api/admin/campaigns/[id] */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const rows = await db('SELECT * FROM campaigns WHERE id = $1 LIMIT 1', [Number(id)]);
  if (!rows[0]) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }
  return NextResponse.json({ campaign: rows[0] });
}

/** PATCH /api/admin/campaigns/[id] — update campaign details, funding, or status */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const campaignId = Number(id);
  if (Number.isNaN(campaignId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const existingRows = await db('SELECT * FROM campaigns WHERE id = $1 LIMIT 1', [campaignId]);
    const existing = existingRows[0];
    if (!existing) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    const body = await request.json();
    const title = body.title !== undefined ? String(body.title).trim() : String(existing.title);
    const slug = body.slug !== undefined && String(body.slug).trim()
      ? slugify(String(body.slug))
      : String(existing.slug);
    const description = body.description !== undefined ? (body.description ? String(body.description).trim() : null) : existing.description;
    const goal_amount = body.goal_amount !== undefined ? (body.goal_amount ? Number(body.goal_amount) : null) : existing.goal_amount;
    const raised_amount = body.raised_amount !== undefined ? Number(body.raised_amount) : Number(existing.raised_amount ?? 0);
    const status = body.status && ['active', 'paused', 'completed', 'cancelled'].includes(body.status)
      ? body.status
      : existing.status;
    const start_date = body.start_date !== undefined ? (body.start_date || null) : existing.start_date;
    const end_date = body.end_date !== undefined ? (body.end_date || null) : existing.end_date;
    const image_url = body.image_url !== undefined ? (body.image_url ? String(body.image_url).trim() : null) : existing.image_url;

    if (!title) {
      return NextResponse.json({ error: 'Campaign title cannot be empty' }, { status: 400 });
    }
    if (image_url && !isSafeMediaSrc(String(image_url))) {
      return NextResponse.json(
        { error: 'Invalid image URL. Use a relative /images/... path or https:// URL.' },
        { status: 400 },
      );
    }

    const updated = await db(
      `UPDATE campaigns
       SET title = $1,
           slug = $2,
           description = $3,
           goal_amount = $4,
           raised_amount = $5,
           status = $6,
           start_date = $7,
           end_date = $8,
           image_url = $9,
           updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [title, slug, description, goal_amount, raised_amount, status, start_date, end_date, image_url, campaignId],
    );

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'UPDATE_CAMPAIGN', 'campaigns', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        campaignId,
        JSON.stringify({ title, slug, goal_amount, raised_amount, status }),
        getClientIp(request),
      ],
    );

    revalidatePath('/campaigns');
    revalidatePath('/dashboard/campaigns');
    revalidatePath(`/dashboard/campaigns/${campaignId}`);
    revalidatePath('/dashboard');

    return NextResponse.json({ success: true, campaign: updated[0] });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('unique') || message.includes('duplicate')) {
      return NextResponse.json({ error: 'A campaign with that slug already exists' }, { status: 409 });
    }
    console.error('[PATCH /api/admin/campaigns/[id]] Error:', err);
    return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 });
  }
}

/** DELETE /api/admin/campaigns/[id] */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const campaignId = Number(id);
  const deleted = await db('DELETE FROM campaigns WHERE id = $1 RETURNING id, title', [campaignId]);
  if (!deleted[0]) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  await db(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
     VALUES ($1, 'DELETE_CAMPAIGN', 'campaigns', $2, $3, $4)`,
    [Number(session.user.id) || null, campaignId, JSON.stringify(deleted[0]), getClientIp(request)],
  );

  revalidatePath('/campaigns');
  revalidatePath('/dashboard/campaigns');
  revalidatePath('/dashboard');

  return NextResponse.json({ success: true });
}
