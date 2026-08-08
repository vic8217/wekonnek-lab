import { NextRequest, NextResponse } from 'next/server';

const BACKEND = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000') + '/api/bazaar-promos';

async function proxy(request: NextRequest, path?: string[]) {
  const url = new URL(`${BACKEND}${path?.length ? `/${path.join('/')}` : ''}`);
  request.nextUrl.searchParams.forEach((value, key) => url.searchParams.append(key, value));
  try {
    const response = await fetch(url, {
      method: request.method,
      headers: { 'Content-Type': 'application/json', ...(request.headers.get('authorization') ? { Authorization: request.headers.get('authorization')! } : {}) },
      body: request.method === 'GET' ? undefined : await request.text(),
      cache: 'no-store',
    });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ message: 'Bazaar promotion service unavailable' }, { status: 503 });
  }
}

type Context = { params: Promise<{ path?: string[] }> };
export async function GET(request: NextRequest, context: Context) { return proxy(request, (await context.params).path); }
export async function POST(request: NextRequest, context: Context) { return proxy(request, (await context.params).path); }
export async function PATCH(request: NextRequest, context: Context) { return proxy(request, (await context.params).path); }
export async function DELETE(request: NextRequest, context: Context) { return proxy(request, (await context.params).path); }
