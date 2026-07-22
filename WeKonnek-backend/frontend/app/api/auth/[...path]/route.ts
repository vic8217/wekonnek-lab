import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:3000';
const REQUEST_TIMEOUT_MS = 10_000;

async function proxyAuth(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const target = new URL(`/api/auth/${path.join('/')}`, BACKEND_URL);
    request.nextUrl.searchParams.forEach((value, key) => target.searchParams.append(key, value));
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
    const response = await fetch(target, {
      method: request.method,
      headers: {
        accept: 'application/json',
        ...(request.headers.get('content-type') ? { 'content-type': request.headers.get('content-type')! } : {}),
        ...(request.headers.get('authorization') ? { authorization: request.headers.get('authorization')! } : {}),
      },
      body,
      cache: 'no-store',
      signal: controller.signal,
    });

    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return NextResponse.json(
        { message: response.ok ? 'Authentication service returned an invalid response.' : 'Authentication service is temporarily unavailable. Please try again.' },
        { status: response.ok ? 502 : response.status >= 500 ? 503 : response.status },
      );
    }

    try {
      return NextResponse.json(JSON.parse(text), { status: response.status });
    } catch {
      return NextResponse.json({ message: 'Authentication service returned an invalid response.' }, { status: 502 });
    }
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return NextResponse.json(
      { message: timedOut ? 'Authentication request timed out. Please try again.' : 'Authentication service is temporarily unavailable. Please confirm the backend service is running.' },
      { status: 503 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

type Context = { params: Promise<{ path: string[] }> };
export const GET = (request: NextRequest, context: Context) => proxyAuth(request, context);
export const POST = (request: NextRequest, context: Context) => proxyAuth(request, context);
export const PUT = (request: NextRequest, context: Context) => proxyAuth(request, context);
export const PATCH = (request: NextRequest, context: Context) => proxyAuth(request, context);
export const DELETE = (request: NextRequest, context: Context) => proxyAuth(request, context);
