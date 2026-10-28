import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { db, getClientIp } from '@/lib/db';
import { ensureMembersSchemaReady } from '@/lib/members-server';

function generateMembershipNo(): string {
  const year = new Date().getFullYear();
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `OVC-${year}-${token}`;
}

/**
 * GET /api/membership?ref=OVC-2026-XXXXXXXX&email=user@example.com
 * Looks up an existing membership application status when BOTH reference number AND email match.
 * Returns only non-PII status metadata.
 */
export async function GET(request: Request) {
  await ensureMembersSchemaReady();
  const { searchParams } = new URL(request.url);
  const ref = searchParams.get('ref')?.trim() || '';
  const email = searchParams.get('email')?.trim().toLowerCase() || '';

  if (!ref || !email) {
    return NextResponse.json(
      { error: 'Both application reference and email are required' },
      { status: 400 },
    );
  }

  try {
    const rows = await db(
      `SELECT membership_no, status, joined_at, created_at, updated_at
       FROM members
       WHERE UPPER(membership_no) = UPPER($1)
         AND LOWER(email) = LOWER($2)
       ORDER BY id DESC
       LIMIT 1`,
      [ref, email],
    );

    if (!rows[0]) {
      return NextResponse.json({ found: false }, { status: 404 });
    }

    return NextResponse.json({ found: true, application: rows[0] });
  } catch (err) {
    console.error('[GET /api/membership] Error:', err);
    return NextResponse.json({ error: 'Failed to check application status' }, { status: 500 });
  }
}

/**
 * POST /api/membership
 * Public endpoint to submit and store a new membership registration application
 * with status = 'pending' (Pending Review).
 */
export async function POST(request: Request) {
  await ensureMembersSchemaReady();

  try {
    const body = await request.json();
    const full_name = String(body.full_name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const address = String(body.address || '').trim();
    const occupation = String(body.occupation || '').trim();
    const reason = String(body.reason || body.application_reason || '').trim();
    const providedRef = String(body.membership_no || '').trim();

    if (full_name.length < 2) {
      return NextResponse.json({ error: 'Please enter your full name (at least 2 characters).' }, { status: 400 });
    }
    if (!email || !email.includes('@') || !email.includes('.')) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }
    if (phone.length < 5) {
      return NextResponse.json({ error: 'Please enter a valid phone number.' }, { status: 400 });
    }
    if (address.length < 8) {
      return NextResponse.json({ error: 'Please enter your residential address (at least 8 characters).' }, { status: 400 });
    }
    if (occupation.length < 2) {
      return NextResponse.json({ error: 'Please enter your occupation.' }, { status: 400 });
    }
    if (reason.length < 20) {
      return NextResponse.json(
        { error: 'Please tell us why you would like to join (at least 20 characters).' },
        { status: 400 },
      );
    }

    const notesSummary = `Online Application | Occupation: ${occupation} | Reason: ${reason}`;

    // Check if an application or member with this email already exists
    const existingRows = await db(
      'SELECT * FROM members WHERE LOWER(email) = LOWER($1) LIMIT 1',
      [email],
    );

    if (existingRows[0]) {
      const existing = existingRows[0];
      // Only allow updating a pending application if the caller proves possession of the matching reference number
      if (
        existing.status === 'pending' &&
        providedRef &&
        String(existing.membership_no || '').toUpperCase() === providedRef.toUpperCase()
      ) {
        const updatedRows = await db(
          `UPDATE members
           SET full_name = $1,
               phone = $2,
               address = $3,
               occupation = $4,
               application_reason = $5,
               notes = $6,
               updated_at = NOW()
           WHERE id = $7
           RETURNING id, full_name, email, phone, address, occupation, application_reason, membership_no, status, joined_at, created_at, updated_at`,
          [full_name, phone, address, occupation, reason, notesSummary, existing.id],
        );

        revalidatePath('/dashboard/members');
        revalidatePath('/dashboard');

        return NextResponse.json({
          success: true,
          updated: true,
          application: updatedRows[0],
        });
      }

      return NextResponse.json(
        {
          error:
            'An application or membership with this email address is already on file. Please contact the secretariat if you need to update your details.',
        },
        { status: 409 },
      );
    }

    const membership_no = generateMembershipNo();

    const insertedRows = await db(
      `INSERT INTO members (
         full_name,
         email,
         phone,
         address,
         occupation,
         application_reason,
         membership_no,
         status,
         notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
       RETURNING id, full_name, email, phone, address, occupation, application_reason, membership_no, status, joined_at, created_at, updated_at`,
      [full_name, email, phone, address, occupation, reason, membership_no, notesSummary],
    );

    const application = insertedRows[0];

    try {
      await db(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
         VALUES (NULL, 'SUBMIT_MEMBERSHIP_APPLICATION', 'members', $1, $2, $3)`,
        [
          application?.id ?? null,
          JSON.stringify({
            full_name,
            email,
            phone,
            occupation,
            membership_no,
            status: 'pending',
          }),
          getClientIp(request),
        ],
      );
    } catch {
      // Non-fatal if audit_logs insert fails
    }

    revalidatePath('/dashboard/members');
    revalidatePath('/dashboard');

    return NextResponse.json({
      success: true,
      application,
    });
  } catch (err) {
    console.error('[POST /api/membership] Error:', err);
    return NextResponse.json(
      { error: 'Unable to submit your application right now. Please try again or use the email/download option below.' },
      { status: 500 },
    );
  }
}
