import { NextRequest, NextResponse } from 'next/server';

// ════════════════════════════════════════════════════════════════════
// POST /api/invoices/[id]/void — Void an invoice
// Body: { reason }
// ════════════════════════════════════════════════════════════════════

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const invoiceId = parseInt(id);
    const body = await request.json();
    const { reason } = body;

    if (!reason) {
      return NextResponse.json({ error: 'Void reason is required' }, { status: 400 });
    }

    const { voidInvoice } = await import('@/lib/e-invoice');
    const success = await voidInvoice(invoiceId, reason);

    if (!success) {
      return NextResponse.json({ error: 'Failed to void invoice' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Invoice voided' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
