import { NextResponse } from 'next/server';

// Auth is handled client-side via useRequireAuth() (JWT + localStorage).
export function proxy() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/merchant/:path*',
    '/customer/:path*',
  ],
};
