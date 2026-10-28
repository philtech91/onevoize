import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db, getClientIp } from '@/lib/db';

/** PATCH /api/admin/donations/[id] — update donation status */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const donationId = Number(id);
  if (Number.isNaN(donationId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const status = body.status;
    if (!['success', 'pending', 'failed'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const existingRows = await db('SELECT * FROM donations WHERE id = $1 LIMIT 1', [donationId]);
    const existing = existingRows[0];
    if (!existing) {
      return NextResponse.json({ error: 'Donation not found' }, { status: 404 });
    }

    const prevStatus = String(existing.status);
    const paidAt =
      status === 'success' && !existing.paid_at ? new Date().toISOString() : existing.paid_at;

    const updated = await db(
      `UPDATE donations
       SET status = $1,
           paid_at = $2
       WHERE id = $3
       RETURNING *`,
      [status, paidAt, donationId],
    );

    // Keep linked campaign raised_amount synchronized when transitioning to/from 'success'
    const amount = Number(existing.amount || 0);
    const campaign = existing.campaign ? String(existing.campaign).trim() : '';
    if (campaign && amount > 0 && prevStatus !== status) {
      if (status === 'success' && prevStatus !== 'success') {
        await db(
          `UPDATE campaigns
           SET raised_amount = COALESCE(raised_amount, 0) + $1,
               updated_at = NOW()
           WHERE LOWER(title) = LOWER($2) OR LOWER(slug) = LOWER($2) OR CAST(id AS TEXT) = $2`,
          [amount, campaign],
        );
      } else if (prevStatus === 'success' && status !== 'success') {
        await db(
          `UPDATE campaigns
           SET raised_amount = GREATEST(0, COALESCE(raised_amount, 0) - $1),
               updated_at = NOW()
           WHERE LOWER(title) = LOWER($2) OR LOWER(slug) = LOWER($2) OR CAST(id AS TEXT) = $2`,
          [amount, campaign],
        );
      }
    }

    await db(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
       VALUES ($1, 'UPDATE_DONATION_STATUS', 'donations', $2, $3, $4)`,
      [
        Number(session.user.id) || null,
        donationId,
        JSON.stringify({ reference: existing.reference, from: prevStatus, to: status }),
        getClientIp(request),
      ],
    );

    revalidatePath('/dashboard/donations');
    revalidatePath('/dashboard/campaigns');
    revalidatePath('/campaigns');
    revalidatePath('/dashboard');

    return NextResponse.json({ success: true, donation: updated[0] });
  } catch (err: unknown) {
    console.error('[PATCH /api/admin/donations/[id]] Error:', err);
    return NextResponse.json({ error: 'Failed to update donation' }, { status: 500 });
  }
}

/** DELETE /api/admin/donations/[id] */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const donationId = Number(id);
  const deleted = await db(
    'DELETE FROM donations WHERE id = $1 RETURNING id, reference, donor_name, amount, status, campaign',
    [donationId],
  );
  if (!deleted[0]) {
    return NextResponse.json({ error: 'Donation not found' }, { status: 404 });
  }

  const row = deleted[0];
  if (row.status === 'success' && row.campaign && Number(row.amount) > 0) {
    await db(
      `UPDATE campaigns
       SET raised_amount = GREATEST(0, COALESCE(raised_amount, 0) - $1),
           updated_at = NOW()
       WHERE LOWER(title) = LOWER($2) OR LOWER(slug) = LOWER($2) OR CAST(id AS TEXT) = $2`,
      [Number(row.amount), String(row.campaign).trim()],
    );
  }

  await db(
    `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip_address)
     VALUES ($1, 'DELETE_DONATION', 'donations', $2, $3, $4)`,
    [Number(session.user.id) || null, donationId, JSON.stringify(row), getClientIp(request)],
  );

  revalidatePath('/dashboard/donations');
  revalidatePath('/dashboard/campaigns');
  revalidatePath('/campaigns');
  revalidatePath('/dashboard');

  return NextResponse.json({ success: true });
}
