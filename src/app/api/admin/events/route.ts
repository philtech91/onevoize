import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';
import { isSafeMediaSrc } from '@/lib/gallery-server';

/** GET /api/admin/events */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rows = await db('SELECT * FROM events ORDER BY event_date DESC');
  return NextResponse.json({ events: rows });
}

/** POST /api/admin/events — create a new event */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const title = String(body.title || '').trim();
    const description = body.description ? String(body.description).trim() : null;
    const location = body.location ? String(body.location).trim() : null;
    const event_date = body.event_date;
    const end_date = body.end_date || null;
    const status = ['upcoming', 'ongoing', 'completed', 'cancelled'].includes(body.status)
      ? body.status
      : 'upcoming';
    const image_url = body.image_url ? String(body.image_url).trim() : null;
    const max_attendees = body.max_attendees ? Number(body.max_attendees) : null;

    if (!title || !event_date) {
      return NextResponse.json({ error: 'Title and event date are required' }, { status: 400 });
    }
    if (image_url && !isSafeMediaSrc(image_url)) {
      return NextResponse.json(
        { error: 'Invalid image URL. Use a relative /images/... path or https:// URL.' },
        { status: 400 },
      );
    }

    const rows = await db(
      `INSERT INTO events (title, description, location, event_date, end_date, status, image_url, max_attendees, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        title,
        description,
        location,
        event_date,
        end_date,
        status,
        image_url,
        max_attendees,
        Number(session.user.id) || null,
      ],
    );

    const event = rows[0];

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'CREATE_EVENT', 'events', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        event?.id ?? null,
        JSON.stringify({ title, event_date, status }),
        getClientIp(request),
      ],
    );

    revalidatePath('/events');
    revalidatePath('/dashboard/events');
    revalidatePath('/dashboard');

    return NextResponse.json({ success: true, event });
  } catch (err: unknown) {
    console.error('[POST /api/admin/events] Error:', err);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
