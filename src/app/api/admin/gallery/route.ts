import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';
import {
  ensureGalleryReady,
  getGalleryItems,
  isSafeMediaSrc,
  MediaValidationError,
  saveUploadedMedia,
} from '@/lib/gallery-server';

/** GET /api/admin/gallery — list all gallery items */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get('type');
  const mediaType = typeParam === 'image' || typeParam === 'video' ? typeParam : undefined;

  const items = await getGalleryItems({ mediaType });
  return NextResponse.json({ items });
}

/** POST /api/admin/gallery — create a new gallery photo or video */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureGalleryReady();

    let media_type: 'image' | 'video' = 'image';
    let src = '';
    let title = '';
    let caption = '';
    let alt_text = '';
    let category = 'club';
    let display_order: number | null = null;
    let is_published = true;

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const rawType = String(formData.get('media_type') || 'image');
      media_type = rawType === 'video' ? 'video' : 'image';
      title = String(formData.get('title') || '').trim();
      caption = String(formData.get('caption') || '').trim();
      alt_text = String(formData.get('alt_text') || '').trim();
      category = String(formData.get('category') || 'club').trim() || 'club';
      const orderStr = formData.get('display_order');
      if (orderStr !== null && String(orderStr).trim() !== '') {
        display_order = Number(orderStr);
      }
      const pubVal = formData.get('is_published');
      if (pubVal !== null) {
        is_published = String(pubVal) !== 'false';
      }

      const file = formData.get('file');
      if (file instanceof File && file.size > 0) {
        src = await saveUploadedMedia(file);
      } else {
        src = String(formData.get('src') || '').trim();
      }
    } else {
      const body = await request.json();
      media_type = body.media_type === 'video' ? 'video' : 'image';
      src = String(body.src || '').trim();
      title = String(body.title || '').trim();
      caption = String(body.caption || '').trim();
      alt_text = String(body.alt_text || '').trim();
      category = String(body.category || 'club').trim() || 'club';
      if (body.display_order !== undefined && body.display_order !== null && body.display_order !== '') {
        display_order = Number(body.display_order);
      }
      if (typeof body.is_published === 'boolean') {
        is_published = body.is_published;
      }
    }

    if (!src) {
      return NextResponse.json({ error: 'Media file or source URL is required' }, { status: 400 });
    }
    if (!isSafeMediaSrc(src)) {
      return NextResponse.json(
        { error: 'Invalid media source URL. Use a relative /images/... path or https:// URL.' },
        { status: 400 },
      );
    }
    if (!title) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    if (display_order === null || Number.isNaN(display_order)) {
      const maxRows = await db<{ max_order: number }>(
        'SELECT COALESCE(MAX(display_order), 0) as max_order FROM gallery_items',
      );
      display_order = Number(maxRows[0]?.max_order ?? 0) + 1;
    }

    const effectiveAlt = alt_text || caption || title;

    const inserted = await db(
      `INSERT INTO gallery_items (media_type, src, title, caption, alt_text, category, display_order, is_published, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        media_type,
        src,
        title,
        caption || null,
        effectiveAlt,
        category,
        display_order,
        is_published,
        Number(session.user.id) || null,
      ],
    );

    const item = inserted[0];

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'CREATE_GALLERY_ITEM', 'gallery_items', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        item?.id ?? null,
        JSON.stringify({ media_type, title, src }),
        getClientIp(request),
      ],
    );

    revalidatePath('/gallery');
    revalidatePath('/');
    revalidatePath('/dashboard/gallery');
    revalidatePath('/dashboard');

    return NextResponse.json({ success: true, item });
  } catch (err: unknown) {
    if (err instanceof MediaValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[POST /api/admin/gallery] Error:', err);
    return NextResponse.json({ error: 'Failed to create gallery item' }, { status: 500 });
  }
}
