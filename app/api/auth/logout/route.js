import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/localAuth";

/**
 * POST /api/auth/logout
 *
 * Cuma hapus cookie. Device binding TIDAK dilepas — logout bukan berarti
 * pindah perangkat. Untuk pindah perangkat, user pakai /reset-device di bot.
 *
 * App Android: cukup buang token yang disimpan lokal.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });

  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return res;
}
