import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";

// Halaman yang boleh diakses tanpa syarat (biar gak infinite redirect loop)
const PUBLIC_PATHS = ["/login", "/not-member", "/api/auth", "/api/webhook", "/collab-request", "/api/collab-request"];

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  // Belum login sama sekali -> ke halaman login
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Sudah login tapi bukan anggota server Discord kita -> tolak akses
  if (!token.isMember) {
    return NextResponse.redirect(new URL("/not-member", req.url));
  }

  // Halaman /admin cuma untuk role admin
  if (pathname.startsWith("/admin") && !token.isAdmin) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // API garapan: GET boleh semua member, method lain cuma admin (dicek lagi di route handler)
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Semua path KECUALI file statis next.js, favicon, dsb.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
