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
    pathname.includes('.') // Static files like .ico, .png, etc.
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
    // Already in sistema route group, don't rewrite
    if (pathname.startsWith('/sistema')) {
      return NextResponse.next();
    }

    // Rewrite to (sistema) route group
    const url = request.nextUrl.clone();
    url.pathname = `/sistema${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Default: POS system — routes exist at root level, just pass through
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images folder
     */
    '/((?!_next/static|_next/image|favicon.ico|images).*)',
  ],
};
