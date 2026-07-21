import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3000';

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const merchantId = sp.get('merchant_id');
    const exportType = sp.get('type') || 'sales_journal';
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');

    if (!merchantId) {
      return NextResponse.json({ error: 'merchant_id is required' }, { status: 400 });
    }

    const authHeader = request.headers.get('authorization');
    const headers: Record<string, string> = {};
    if (authHeader) headers['Authorization'] = authHeader;

    const params = new URLSearchParams({ merchantId });
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    const res = await fetch(`${BACKEND_API}/api/invoices?${params}`, { headers });
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch invoices' }, { status: res.status });
    }

    const result = await res.json();
    const invoices = Array.isArray(result) ? result : result.data || result.invoices || [];

    const { exportSalesJournalCSV, exportVATSummaryCSV } = await import('@/lib/e-invoice');

    const csv = exportType === 'vat_summary'
      ? exportVATSummaryCSV(invoices)
      : exportSalesJournalCSV(invoices);

    const filename = `${exportType}_${merchantId}_${dateFrom || 'all'}_${dateTo || 'all'}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
