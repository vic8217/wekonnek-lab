import { NextRequest, NextResponse } from 'next/server';

// ════════════════════════════════════════════════════════════════════
// GET /api/invoices/summary — Get/generate daily sales summary
// Query params: merchant_id, date
// ════════════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const merchantId = sp.get('merchant_id');
    const date = sp.get('date');

    if (!merchantId || !date) {
      return NextResponse.json(
        { error: 'merchant_id and date are required' },
        { status: 400 }
      );
    }

    const { generateDailySummary } = await import('@/lib/e-invoice');
    const summary = await generateDailySummary(parseInt(merchantId), date);

    if (!summary) {
      return NextResponse.json({ error: 'Failed to generate summary' }, { status: 500 });
    }

    return NextResponse.json({ summary });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
