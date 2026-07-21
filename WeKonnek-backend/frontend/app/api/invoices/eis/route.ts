import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { invoice_id } = body;

    if (!invoice_id) {
      return NextResponse.json({ error: 'invoice_id is required' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authHeader) headers['Authorization'] = authHeader;

    const res = await fetch(`${BACKEND_API}/api/invoices/${invoice_id}/eis-queue`, {
      method: 'POST',
      headers,
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to queue EIS transmission' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'EIS transmission queued' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const invoiceId = request.nextUrl.searchParams.get('invoice_id');
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoice_id is required' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    const headers: Record<string, string> = {};
    if (authHeader) headers['Authorization'] = authHeader;

    const res = await fetch(`${BACKEND_API}/api/invoices/${invoiceId}/eis-status`, { headers });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch EIS status' }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
