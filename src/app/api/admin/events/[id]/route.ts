import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';
import { isSafeMediaSrc } from '@/lib/gallery-server';

/** GET /api/admin/events/[id] */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const rows = await db('SELECT * FROM events WHERE id = $1 LIMIT 1', [Number(id)]);
  if (!rows[0]) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }
  return NextResponse.json({ event: rows[0] });
}

/** PATCH /api/admin/events/[id] — update an event */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const eventId = Number(id);
  if (Number.isNaN(eventId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const existingRows = await db('SELECT * FROM events WHERE id = $1 LIMIT 1', [eventId]);
    const existing = existingRows[0];
    if (!existing) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const body = await request.json();
    const title = body.title !== undefined ? String(body.title).trim() : String(existing.title);
    const description = body.description !== undefined ? (body.description ? String(body.description).trim() : null) : existing.description;
    const location = body.location !== undefined ? (body.location ? String(body.location).trim() : null) : existing.location;
    const event_date = body.event_date || existing.event_date;
    const end_date = body.end_date !== undefined ? (body.end_date || null) : existing.end_date;
    const status = body.status && ['upcoming', 'ongoing', 'completed', 'cancelled'].includes(body.status)
      ? body.status
      : existing.status;
    const image_url = body.image_url !== undefined ? (body.image_url ? String(body.image_url).trim() : null) : existing.image_url;
    const max_attendees = body.max_attendees !== undefined
      ? (body.max_attendees ? Number(body.max_attendees) : null)
      : existing.max_attendees;

    if (!title) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }
    if (image_url && !isSafeMediaSrc(String(image_url))) {
      return NextResponse.json(
        { error: 'Invalid image URL. Use a relative /images/... path or https:// URL.' },
        { status: 400 },
      );
    }

    const updated = await db(
      `UPDATE events
       SET title = $1,
           description = $2,
           location = $3,
           event_date = $4,
           end_date = $5,
           status = $6,
           image_url = $7,
           max_attendees = $8,
           updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [title, description, location, event_date, end_date, status, image_url, max_attendees, eventId],
    );

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'UPDATE_EVENT', 'events', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        eventId,
        JSON.stringify({ title, status, event_date }),
        getClientIp(request),
      ],
    );

    revalidatePath('/events');
    revalidatePath('/dashboard/events');
    revalidatePath(`/dashboard/events/${eventId}`);
    revalidatePath('/dashboard');

    return NextResponse.json({ success: true, event: updated[0] });
  } catch (err: unknown) {
    console.error('[PATCH /api/admin/events/[id]] Error:', err);
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

/** DELETE /api/admin/events/[id] */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const eventId = Number(id);
  const deleted = await db('DELETE FROM events WHERE id = $1 RETURNING id, title', [eventId]);
  if (!deleted[0]) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  await db(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
     VALUES ($1, 'DELETE_EVENT', 'events', $2, $3, $4)`,
    [Number(session.user.id) || null, eventId, JSON.stringify(deleted[0]), getClientIp(request)],
  );

  revalidatePath('/events');
  revalidatePath('/dashboard/events');
  revalidatePath('/dashboard');

  return NextResponse.json({ success: true });
}
