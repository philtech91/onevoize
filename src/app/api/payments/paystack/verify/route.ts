import { NextResponse } from 'next/server'
import { paystackVerify, recordPaystackTransactionInDb } from '@/lib/payments/paystack'

async function handleVerify(reference: string) {
  const cleanRef = reference.trim()
  if (!cleanRef) {
    return NextResponse.json({ error: 'Reference is required.' }, { status: 400 })
  }

  const transaction = await paystackVerify(cleanRef)
  const donation = await recordPaystackTransactionInDb(transaction)

  return NextResponse.json({
    success: transaction.status === 'success',
    donation: donation
      ? {
          reference: donation.reference,
          donor_name: donation.donor_name,
          amount: donation.amount,
          currency: donation.currency,
          status: donation.status,
          campaign: donation.campaign,
          channel: donation.channel,
          paid_at: donation.paid_at,
        }
      : null,
  })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const reference = String(body.reference || body.trxref || '')
    return await handleVerify(reference)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Verification failed.' },
      { status: 400 },
    )
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const reference = searchParams.get('reference') || searchParams.get('trxref') || ''
    return await handleVerify(reference)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Verification failed.' },
      { status: 400 },
    )
  }
}
