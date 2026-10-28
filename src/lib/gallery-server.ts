import { writeFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { db } from '@/lib/db';
import { clubPhotos, clubVideos, type GalleryPhoto, type GalleryVideo } from '@/lib/gallery';

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov']);
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);
const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_FALLBACK_DATA_URI_BYTES = 2 * 1024 * 1024; // 2 MB

export class MediaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaValidationError';
  }
}

export function isSafeMediaSrc(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
    return true;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return true;
  }
  if (/^data:image\/(jpeg|png|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(trimmed)) {
    return true;
  }
  return false;
}

export async function saveUploadedMedia(file: File): Promise<string> {
  const rawExt = extname(file.name).toLowerCase();
  const mime = (file.type || '').toLowerCase();

  const isVideo = ALLOWED_VIDEO_EXTENSIONS.has(rawExt) || ALLOWED_VIDEO_MIMES.has(mime);
  const isImage = ALLOWED_IMAGE_EXTENSIONS.has(rawExt) || ALLOWED_IMAGE_MIMES.has(mime);

  if (!isImage && !isVideo) {
    throw new MediaValidationError(
      'Unsupported file type. Allowed formats: JPG, PNG, WebP, GIF, AVIF, MP4, WebM, MOV.',
    );
  }

  if (rawExt && !ALLOWED_IMAGE_EXTENSIONS.has(rawExt) && !ALLOWED_VIDEO_EXTENSIONS.has(rawExt)) {
    throw new MediaValidationError(
      'Unsupported file extension. Allowed formats: .jpg, .jpeg, .png, .webp, .gif, .avif, .mp4, .webm, .mov.',
    );
  }

  if (mime && !ALLOWED_IMAGE_MIMES.has(mime) && !ALLOWED_VIDEO_MIMES.has(mime)) {
    throw new MediaValidationError('Unsupported media MIME type.');
  }

  const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > maxBytes) {
    throw new MediaValidationError(
      `File exceeds maximum size limit (${isVideo ? '50 MB for video' : '10 MB for image'}).`,
    );
  }

  const ext =
    rawExt ||
    (isVideo ? '.mp4' : mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg');

  const safeBase =
    file.name
      .replace(/\.[^/.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'media';

  const filename = `${safeBase}-${Date.now()}${ext}`;
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  try {
    const uploadDir = join(process.cwd(), 'public', 'images', 'club');
    await mkdir(uploadDir, { recursive: true });
    const filePath = join(uploadDir, filename);
    await writeFile(filePath, buffer);
    return `/images/club/${filename}`;
  } catch {
    if (isVideo || file.size > MAX_FALLBACK_DATA_URI_BYTES) {
      throw new MediaValidationError(
        'Direct file uploads on read-only serverless storage are limited to images under 2 MB. Please provide an external media URL instead.',
      );
    }
    const safeMime = ALLOWED_IMAGE_MIMES.has(mime) ? mime : 'image/jpeg';
    return `data:${safeMime};base64,${buffer.toString('base64')}`;
  }
}

export type GalleryItemRecord = {
  id: number;
  media_type: 'image' | 'video';
  src: string;
  title: string;
  caption: string | null;
  alt_text: string | null;
  category: string;
  display_order: number;
  is_published: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

let _initialized = false;

/**
 * Ensures the `gallery_items` table exists in Neon DB and seeds it
 * with the initial static photos and videos from `src/lib/gallery.ts`
 * if the table is completely empty.
 */
export async function ensureGalleryReady(): Promise<void> {
  if (_initialized) return;

  await db(`
    CREATE TABLE IF NOT EXISTS gallery_items (
      id            SERIAL PRIMARY KEY,
      media_type    TEXT        NOT NULL DEFAULT 'image'
                                CHECK (media_type IN ('image', 'video')),
      src           TEXT        NOT NULL,
      title         TEXT        NOT NULL,
      caption       TEXT,
      alt_text      TEXT,
      category      TEXT        NOT NULL DEFAULT 'club',
      display_order INT         NOT NULL DEFAULT 0,
      is_published  BOOLEAN     NOT NULL DEFAULT TRUE,
      created_by    INT         REFERENCES users(id),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const countRows = await db<{ count: string }>('SELECT COUNT(*) as count FROM gallery_items');
  const count = Number(countRows[0]?.count ?? 0);

  if (count === 0) {
    let order = 1;
    for (const [src, alt] of clubPhotos) {
      const shortTitle = alt.length > 64 ? `${alt.slice(0, 61)}...` : alt;
      await db(
        `INSERT INTO gallery_items (media_type, src, title, caption, alt_text, category, display_order, is_published)
         VALUES ('image', $1, $2, $3, $4, 'club', $5, TRUE)`,
        [src, shortTitle, alt, alt, order++],
      );
    }

    for (const video of clubVideos) {
      await db(
        `INSERT INTO gallery_items (media_type, src, title, caption, alt_text, category, display_order, is_published)
         VALUES ('video', $1, $2, $3, $4, 'events', $5, TRUE)`,
        [video.src, video.title, video.caption, video.title, order++],
      );
    }
  }

  _initialized = true;
}

export async function getGalleryItems(options?: {
  mediaType?: 'image' | 'video';
  publishedOnly?: boolean;
}): Promise<GalleryItemRecord[]> {
  try {
    await ensureGalleryReady();

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.mediaType) {
      params.push(options.mediaType);
      conditions.push(`media_type = $${params.length}`);
    }
    if (options?.publishedOnly) {
      conditions.push('is_published = TRUE');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await db<GalleryItemRecord>(
      `SELECT * FROM gallery_items ${where} ORDER BY display_order ASC, id ASC`,
      params,
    );
    return rows;
  } catch {
    // Fallback to static items if DB connection is unavailable
    const fallbackImages: GalleryItemRecord[] = clubPhotos.map(([src, alt], idx) => ({
      id: idx + 1,
      media_type: 'image',
      src,
      title: alt.length > 64 ? `${alt.slice(0, 61)}...` : alt,
      caption: alt,
      alt_text: alt,
      category: 'club',
      display_order: idx + 1,
      is_published: true,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const fallbackVideos: GalleryItemRecord[] = clubVideos.map((v, idx) => ({
      id: fallbackImages.length + idx + 1,
      media_type: 'video',
      src: v.src,
      title: v.title,
      caption: v.caption,
      alt_text: v.title,
      category: 'events',
      display_order: fallbackImages.length + idx + 1,
      is_published: true,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    let combined = [...fallbackImages, ...fallbackVideos];
    if (options?.mediaType) {
      combined = combined.filter(item => item.media_type === options.mediaType);
    }
    return combined;
  }
}

export async function getPublicGalleryData(): Promise<{
  photos: GalleryPhoto[];
  videos: GalleryVideo[];
}> {
  const items = await getGalleryItems({ publishedOnly: true });
  const imageItems = items.filter(i => i.media_type === 'image');
  const videoItems = items.filter(i => i.media_type === 'video');

  const photos: GalleryPhoto[] =
    imageItems.length > 0
      ? imageItems.map(i => [i.src, i.alt_text || i.caption || i.title])
      : clubPhotos;

  const videos: GalleryVideo[] =
    videoItems.length > 0
      ? videoItems.map(i => ({
          src: i.src,
          title: i.title,
          caption: i.caption || '',
        }))
      : clubVideos;

  return { photos, videos };
}
