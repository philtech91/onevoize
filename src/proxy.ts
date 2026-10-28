import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let the login page and API auth routes through
  if (pathname.startsWith('/dashboard/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Protect all /dashboard routes
  if (pathname.startsWith('/dashboard')) {
    const session = await auth();
    if (!session?.user?.id) {
      const loginUrl = new URL('/dashboard/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // /dashboard/superadmin requires superadmin role
    if (pathname.startsWith('/dashboard/superadmin') && session.user.role !== 'superadmin') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
