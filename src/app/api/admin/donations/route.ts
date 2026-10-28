import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';

/** POST /api/admin/donations — record a manual or bank transfer donation */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const donor_name = String(body.donor_name || '').trim();
    const donor_email = String(body.donor_email || '').trim();
    const amount = Number(body.amount);
    const status = ['success', 'pending', 'failed'].includes(body.status) ? body.status : 'success';
    const campaign = body.campaign ? String(body.campaign).trim() : null;
    const channel = body.channel ? String(body.channel).trim() : 'bank_transfer';
    const message = body.message ? String(body.message).trim() : null;
    const reference = body.reference
      ? String(body.reference).trim()
      : `OVC-MANUAL-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    if (!donor_name || !donor_email || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: 'Donor name, email, and a positive amount are required' },
        { status: 400 },
      );
    }

    const paid_at = status === 'success' ? new Date().toISOString() : null;

    const rows = await db(
      `INSERT INTO donations (reference, donor_name, donor_email, amount, status, campaign, channel, message, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [reference, donor_name, donor_email, amount, status, campaign, channel, message, paid_at],
    );

    const donation = rows[0];

    if (status === 'success' && campaign) {
      await db(
        `UPDATE campaigns
         SET raised_amount = COALESCE(raised_amount, 0) + $1,
             updated_at = NOW()
         WHERE LOWER(title) = LOWER($2) OR slug = LOWER($2)`,
        [amount, campaign],
      );
    }

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'RECORD_DONATION', 'donations', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        donation?.id ?? null,
        JSON.stringify({ reference, donor_name, amount, status, campaign }),
        getClientIp(request),
      ],
    );

    revalidatePath('/dashboard/donations');
    revalidatePath('/dashboard/campaigns');
    revalidatePath('/campaigns');
    revalidatePath('/dashboard');

    return NextResponse.json({ success: true, donation });
  } catch (err: unknown) {
    console.error('[POST /api/admin/donations] Error:', err);
    return NextResponse.json({ error: 'Failed to record donation' }, { status: 500 });
  }
}
