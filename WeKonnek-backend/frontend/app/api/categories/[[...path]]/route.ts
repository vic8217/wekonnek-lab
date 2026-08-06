import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000') + '/api';

async function proxy(request: NextRequest, path?: string[]) {
  try {
    const suffix = path?.length ? `/${path.join('/')}` : '';
    const url = new URL(`${BACKEND_URL}/categories${suffix}`);
    request.nextUrl.searchParams.forEach((value, key) => url.searchParams.append(key, value));
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = request.headers.get('authorization');
    if (auth) headers.Authorization = auth;
    const response = await fetch(url, {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : await request.text(),
      cache: 'no-store',
    });
    const data = await response.json().catch(() => ({ message: 'Backend request failed' }));
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to reach the category service' }, { status: 503 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, (await params).path);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ path?: string[] }> }) {
  return proxy(request, (await params).path);
}
