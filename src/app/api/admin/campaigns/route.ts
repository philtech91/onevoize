import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';
import { isSafeMediaSrc } from '@/lib/gallery-server';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `campaign-${Date.now()}`;
}

/** GET /api/admin/campaigns */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = await db('SELECT * FROM campaigns ORDER BY created_at DESC');
  return NextResponse.json({ campaigns: rows });
}

/** POST /api/admin/campaigns — create a new fundraising campaign */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const title = String(body.title || '').trim();
    const slug = body.slug ? slugify(String(body.slug)) : slugify(title);
    const description = body.description ? String(body.description).trim() : null;
    const goal_amount = body.goal_amount ? Number(body.goal_amount) : null;
    const raised_amount = body.raised_amount ? Number(body.raised_amount) : 0;
    const status = ['active', 'paused', 'completed', 'cancelled'].includes(body.status)
      ? body.status
      : 'active';
    const start_date = body.start_date || null;
    const end_date = body.end_date || null;
    const image_url = body.image_url ? String(body.image_url).trim() : null;

    if (!title) {
      return NextResponse.json({ error: 'Campaign title is required' }, { status: 400 });
    }
    if (image_url && !isSafeMediaSrc(image_url)) {
      return NextResponse.json(
        { error: 'Invalid image URL. Use a relative /images/... path or https:// URL.' },
        { status: 400 },
      );
    }

    const rows = await db(
      `INSERT INTO campaigns (title, slug, description, goal_amount, raised_amount, status, start_date, end_date, image_url, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        title,
        slug,
        description,
        goal_amount,
        raised_amount,
        status,
        start_date,
        end_date,
        image_url,
        Number(session.user.id) || null,
      ],
    );

    const campaign = rows[0];

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'CREATE_CAMPAIGN', 'campaigns', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        campaign?.id ?? null,
        JSON.stringify({ title, slug, goal_amount, status }),
        getClientIp(request),
      ],
    );

    revalidatePath('/campaigns');
    revalidatePath('/dashboard/campaigns');
    revalidatePath('/dashboard');

    return NextResponse.json({ success: true, campaign });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('unique') || message.includes('duplicate')) {
      return NextResponse.json({ error: 'A campaign with that slug already exists' }, { status: 409 });
    }
    console.error('[POST /api/admin/campaigns] Error:', err);
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 });
  }
}
