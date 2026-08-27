import { NextResponse } from "next/server";
import { verifySessionTokenEdge, SESSION_COOKIE } from "@/lib/sessionEdge";

// /api/* diurus masing-masing route (mereka yang tahu harus balas 401 / 403 /
// 503). Middleware cuma menjaga halaman.
const PUBLIC_PATHS = ["/login", "/not-member", "/api/"];

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Verifikasi HMAC saja — TIDAK query database. Middleware jalan di Edge di
  // setiap request, jadi harus murah. Pengecekan session_version terhadap DB
  // dilakukan di lib/apiAuth.js saat route API dipanggil.
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const result = await verifySessionTokenEdge(token);

  if (!result.ok) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);

    const res = NextResponse.redirect(loginUrl);
    // Cookie busuk/kedaluwarsa dibersihkan, biar tidak loop redirect.
    if (token) {
      res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    }
    return res;
  }

  if (pathname.startsWith("/admin") && result.payload.adm !== 1) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
