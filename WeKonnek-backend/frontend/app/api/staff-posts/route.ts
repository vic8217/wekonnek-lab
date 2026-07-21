import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000') + '/api';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type') || '';
    
    let url = `${BACKEND_URL}/staff-posts`;
    if (type === 'active') {
      url = `${BACKEND_URL}/staff-posts/active`;
    } else if (type === 'expired') {
      url = `${BACKEND_URL}/staff-posts/expired`;
    } else if (type === 'stats') {
      url = `${BACKEND_URL}/staff-posts/stats`;
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Backend request failed' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Proxy error:', error);
    // Check if it's a connection error
    if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      return NextResponse.json(
        { 
          error: 'Backend server is not available',
          message: `Cannot connect to ${BACKEND_URL}. Please ensure the backend server is running.`,
          details: process.env.NODE_ENV === 'development' 
            ? 'In development, make sure the backend is running on port 3000 or set NEXT_PUBLIC_API_URL environment variable.'
            : 'Please check your backend deployment configuration.'
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: error.message || 'Failed to fetch staff posts' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const response = await fetch(`${BACKEND_URL}/staff-posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Backend request failed' }));
      return NextResponse.json(
        errorData,
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Proxy error:', error);
    // Check if it's a connection error
    if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      return NextResponse.json(
        { 
          error: 'Backend server is not available',
          message: `Cannot connect to ${BACKEND_URL}. Please ensure the backend server is running.`,
          details: process.env.NODE_ENV === 'development' 
            ? 'In development, make sure the backend is running on port 3000 or set NEXT_PUBLIC_API_URL environment variable.'
            : 'Please check your backend deployment configuration.'
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: error.message || 'Failed to create staff post' },
      { status: 500 }
    );
  }
}
