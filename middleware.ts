import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') || '';
  const subdomain = hostname.split('.')[0];
  const pathname = request.nextUrl.pathname;

  // Skip static files, API routes, and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/images') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check for ?app=sistema query parameter (for local development)
  const appParam = request.nextUrl.searchParams.get('app');

  // Route to Sistema Inventario if:
  // 1. Subdomain is 'inventario' or 'sistema'
  // 2. Query param ?app=sistema is present
  const isSistema =
    appParam === 'sistema' ||
    subdomain === 'inventario' ||
    subdomain === 'sistema';

  if (isSistema) {
    if (pathname.startsWith('/inventario')) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = `/inventario${pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images).*)',
  ],
};
