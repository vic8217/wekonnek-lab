import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000') + '/api';

// Proxies all sub-category GET reads to the backend:
//   /api/sub-categories                       → GET /sub-categories
//   /api/sub-categories/category/:categoryId  → GET /sub-categories/category/:categoryId
//   /api/sub-categories/:id                   → GET /sub-categories/:id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  try {
    const { path } = await params;
    const suffix = path && path.length ? `/${path.join('/')}` : '';
    const url = new URL(`${BACKEND_URL}/sub-categories${suffix}`);

    // Forward query parameters (e.g. includeInactive).
    request.nextUrl.searchParams.forEach((value, key) => {
      url.searchParams.append(key, value);
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = request.headers.get('authorization');
    if (auth) headers.Authorization = auth;

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Backend request failed' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Sub-categories proxy error:', error);
    if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      return NextResponse.json(
        {
          error: 'Backend server is not available',
          message: `Cannot connect to ${BACKEND_URL}. Please ensure the backend server is running.`,
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: error.message || 'Failed to fetch sub-categories' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  try {
    const { path } = await params;
    const suffix = path?.length ? `/${path.join('/')}` : '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = request.headers.get('authorization');
    if (auth) headers.Authorization = auth;
    const response = await fetch(`${BACKEND_URL}/sub-categories${suffix}`, {
      method: 'POST', headers, body: await request.text(), cache: 'no-store',
    });
    const data = await response.json().catch(() => ({ message: 'Backend request failed' }));
    return NextResponse.json(data, { status: response.status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to reach the sub-category service' }, { status: 503 });
  }
}
