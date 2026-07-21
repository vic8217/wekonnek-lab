import { NextResponse } from 'next/server';

// Auth is now handled client-side via useRequireAuth() (JWT + localStorage).
// This middleware is a pass-through; route protection happens in each page component.
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/merchant/:path*',
    '/customer/:path*',
  ],
};
