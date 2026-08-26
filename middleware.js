import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/not-member", "/api/auth", "/api/garapan", "/api/alpha", "/api/webhook/"];

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (!token.isMember) {
    return NextResponse.redirect(new URL("/not-member", req.url));
  }

  if (pathname.startsWith("/admin") && !token.isAdmin) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
