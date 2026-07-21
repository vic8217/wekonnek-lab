import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API = process.env.BACKEND_API_URL || 'http://localhost:3000';

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const params = new URLSearchParams();
    for (const [key, value] of sp.entries()) {
      params.set(key, value);
    }

    const authHeader = request.headers.get('authorization');
    const headers: Record<string, string> = {};
    if (authHeader) headers['Authorization'] = authHeader;

    const res = await fetch(`${BACKEND_API}/api/invoices?${params}`, { headers });
    const data = await res.json();

    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const authHeader = request.headers.get('authorization');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authHeader) headers['Authorization'] = authHeader;

    const res = await fetch(`${BACKEND_API}/api/invoices`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();

    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
