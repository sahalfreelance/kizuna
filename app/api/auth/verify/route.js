import { NextResponse } from "next/server";
import { verifyDiscordToken, TokenStatus } from "@/lib/mobileAuth";

/**
 * POST /api/auth/verify
 * body: { access_token }
 *
 * PERUBAHAN: dulu semua kegagalan dijadikan 401 "Token Discord tidak
 * valid", termasuk saat Discord rate limit. App lalu membuang token dan
 * memaksa login ulang — padahal tokennya sehat. Sekarang tiap kondisi
 * punya kode sendiri:
 *
 *   200 + { isMember: true }            -> lolos
 *   200 + { isMember: false }           -> token sah, bukan anggota server
 *                                          (app menampilkan "Akses ditolak")
 *   401 + { need_relogin: true }        -> token mati, app refresh/login ulang
 *   503 + { retryable: true }           -> Discord bermasalah, app coba lagi
 *                                          TANPA mengusir user
 */
export async function POST(req) {
  const body = await req.json().catch(() => null);
  const accessToken = body?.access_token;

  if (!accessToken) {
    return NextResponse.json(
      { error: "access_token wajib diisi" },
      { status: 400 }
    );
  }

  const result = await verifyDiscordToken(accessToken);

  if (result.status === TokenStatus.INVALID_TOKEN) {
    return NextResponse.json(
      { error: "Token Discord tidak valid", need_relogin: true },
      { status: 401 }
    );
  }

  if (result.status === TokenStatus.UPSTREAM_ERROR) {
    // Kunci perbaikan: 503, bukan 401. Sesi user tidak boleh dihapus
    // hanya karena Discord sedang rate limit / gangguan.
    return NextResponse.json(
      {
        error: "Tidak bisa memverifikasi ke Discord saat ini. Coba lagi.",
        retryable: true,
      },
      { status: 503 }
    );
  }

  // OK atau NOT_MEMBER: dua-duanya jawaban sah, biar app yang menampilkan.
  return NextResponse.json({
    isMember: result.isMember,
    isAdmin: result.isAdmin,
    user: result.user,
  });
}
