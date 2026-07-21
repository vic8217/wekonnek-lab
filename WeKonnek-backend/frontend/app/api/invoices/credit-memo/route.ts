import { NextRequest, NextResponse } from 'next/server';

// ════════════════════════════════════════════════════════════════════
// POST /api/invoices/credit-memo — Issue credit memo
// Body: { parent_invoice_id, items, reason }
// ════════════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { parent_invoice_id, items, reason } = body;

    if (!parent_invoice_id || !items || !reason) {
      return NextResponse.json(
        { error: 'parent_invoice_id, items, and reason are required' },
        { status: 400 }
      );
    }

    const { issueCreditMemo } = await import('@/lib/e-invoice');
    const creditMemo = await issueCreditMemo(parent_invoice_id, items, reason);

    if (!creditMemo) {
      return NextResponse.json({ error: 'Failed to issue credit memo' }, { status: 500 });
    }

    return NextResponse.json({ invoice: creditMemo }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
