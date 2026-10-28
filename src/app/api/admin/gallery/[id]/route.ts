import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';
import {
  ensureGalleryReady,
  isSafeMediaSrc,
  MediaValidationError,
  saveUploadedMedia,
} from '@/lib/gallery-server';

/** GET /api/admin/gallery/[id] */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  await ensureGalleryReady();
  const rows = await db('SELECT * FROM gallery_items WHERE id = $1 LIMIT 1', [Number(id)]);
  if (!rows[0]) {
    return NextResponse.json({ error: 'Gallery item not found' }, { status: 404 });
  }
  return NextResponse.json({ item: rows[0] });
}

/** PATCH /api/admin/gallery/[id] — update gallery image/video details or replace file */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const itemId = Number(id);
  if (Number.isNaN(itemId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    await ensureGalleryReady();
    const existingRows = await db('SELECT * FROM gallery_items WHERE id = $1 LIMIT 1', [itemId]);
    const existing = existingRows[0];
    if (!existing) {
      return NextResponse.json({ error: 'Gallery item not found' }, { status: 404 });
    }

    let media_type = existing.media_type as string;
    let src = existing.src as string;
    let title = existing.title as string;
    let caption = (existing.caption as string | null) ?? '';
    let alt_text = (existing.alt_text as string | null) ?? '';
    let category = (existing.category as string) || 'club';
    let display_order = Number(existing.display_order ?? 0);
    let is_published = Boolean(existing.is_published);

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      if (formData.has('media_type')) {
        media_type = String(formData.get('media_type')) === 'video' ? 'video' : 'image';
      }
      if (formData.has('title')) {
        title = String(formData.get('title') || '').trim();
      }
      if (formData.has('caption')) {
        caption = String(formData.get('caption') || '').trim();
      }
      if (formData.has('alt_text')) {
        alt_text = String(formData.get('alt_text') || '').trim();
      }
      if (formData.has('category')) {
        category = String(formData.get('category') || 'club').trim() || 'club';
      }
      if (formData.has('display_order')) {
        display_order = Number(formData.get('display_order'));
      }
      if (formData.has('is_published')) {
        is_published = String(formData.get('is_published')) !== 'false';
      }

      const file = formData.get('file');
      if (file instanceof File && file.size > 0) {
        src = await saveUploadedMedia(file);
      } else if (formData.has('src') && String(formData.get('src')).trim()) {
        src = String(formData.get('src')).trim();
      }
    } else {
      const body = await request.json();
      if (body.media_type !== undefined) {
        media_type = body.media_type === 'video' ? 'video' : 'image';
      }
      if (body.src !== undefined && String(body.src).trim()) {
        src = String(body.src).trim();
      }
      if (body.title !== undefined) {
        title = String(body.title).trim();
      }
      if (body.caption !== undefined) {
        caption = String(body.caption).trim();
      }
      if (body.alt_text !== undefined) {
        alt_text = String(body.alt_text).trim();
      }
      if (body.category !== undefined) {
        category = String(body.category).trim() || 'club';
      }
      if (body.display_order !== undefined) {
        display_order = Number(body.display_order);
      }
      if (typeof body.is_published === 'boolean') {
        is_published = body.is_published;
      }
    }

    if (!title) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }
    if (!src) {
      return NextResponse.json({ error: 'Media source cannot be empty' }, { status: 400 });
    }
    if (!isSafeMediaSrc(src)) {
      return NextResponse.json(
        { error: 'Invalid media source URL. Use a relative /images/... path or https:// URL.' },
        { status: 400 },
      );
    }

    const updated = await db(
      `UPDATE gallery_items
       SET media_type = $1,
           src = $2,
           title = $3,
           caption = $4,
           alt_text = $5,
           category = $6,
           display_order = $7,
           is_published = $8,
           updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [
        media_type,
        src,
        title,
        caption || null,
        alt_text || caption || title,
        category,
        display_order,
        is_published,
        itemId,
      ],
    );

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'UPDATE_GALLERY_ITEM', 'gallery_items', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        itemId,
        JSON.stringify({ media_type, title, src, is_published }),
        getClientIp(request),
      ],
    );

    revalidatePath('/gallery');
    revalidatePath('/');
    revalidatePath('/dashboard/gallery');
    revalidatePath('/dashboard');

    return NextResponse.json({ success: true, item: updated[0] });
  } catch (err: unknown) {
    if (err instanceof MediaValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[PATCH /api/admin/gallery/[id]] Error:', err);
    return NextResponse.json({ error: 'Failed to update gallery item' }, { status: 500 });
  }
}

/** DELETE /api/admin/gallery/[id] — delete a gallery item */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const itemId = Number(id);
  if (Number.isNaN(itemId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    await ensureGalleryReady();
    const deleted = await db(
      'DELETE FROM gallery_items WHERE id = $1 RETURNING id, title, media_type, src',
      [itemId],
    );

    if (!deleted[0]) {
      return NextResponse.json({ error: 'Gallery item not found' }, { status: 404 });
    }

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'DELETE_GALLERY_ITEM', 'gallery_items', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        itemId,
        JSON.stringify(deleted[0]),
        getClientIp(request),
      ],
    );

    revalidatePath('/gallery');
    revalidatePath('/');
    revalidatePath('/dashboard/gallery');
    revalidatePath('/dashboard');

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error('[DELETE /api/admin/gallery/[id]] Error:', err);
    return NextResponse.json({ error: 'Failed to delete gallery item' }, { status: 500 });
  }
}
