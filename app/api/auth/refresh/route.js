import { NextResponse } from "next/server";
import { refreshAccessToken } from "@/lib/discordOAuth";
import { verifyDiscordToken } from "@/lib/mobileAuth";

/**
 * POST /api/auth/refresh
 * body: { refresh_token: string }
 *
 * Menukar refresh token jadi access token baru, lalu langsung memverifikasi
 * keanggotaan supaya app cukup satu request untuk memulihkan sesinya.
 *
 * Respons sukses:
 *   { access_token, refresh_token, expires_in, isMember, isAdmin, user }
 *
 * Respons gagal:
 *   401 + { error, need_relogin: true }   -> refresh token sudah mati,
 *                                            user HARUS login ulang
 *   502 + { error }                        -> Discord/jaringan bermasalah,
 *                                            app boleh coba lagi nanti
 *
 * CATATAN ROTASI: Discord mengganti refresh token setiap kali refresh
 * berhasil. App wajib menyimpan `refresh_token` dari respons ini dan
 * membuang yang lama, kalau tidak refresh berikutnya akan gagal.
 */
export async function POST(req) {
  const body = await req.json().catch(() => null);
  const refreshToken = body?.refresh_token;

  if (!refreshToken) {
    return NextResponse.json(
      { error: "refresh_token wajib diisi" },
      { status: 400 }
    );
  }

  let tokens;
  try {
    tokens = await refreshAccessToken(refreshToken);
  } catch (e) {
    if (e.isInvalidGrant) {
      return NextResponse.json(
        {
          error: "Refresh token sudah tidak berlaku. Silakan masuk ulang.",
          need_relogin: true,
        },
        { status: 401 }
      );
    }
    // Bukan salah token — kemungkinan Discord down / jaringan. Jangan
    // suruh user login ulang untuk kasus ini.
    return NextResponse.json(
      { error: "Gagal menghubungi Discord. Coba lagi nanti." },
      { status: 502 }
    );
  }

  const result = await verifyDiscordToken(tokens.access_token);

  if (!result.user) {
    return NextResponse.json(
      {
        error: "Token Discord tidak valid setelah refresh.",
        need_relogin: true,
      },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ...result,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? refreshToken,
    expires_in: tokens.expires_in ?? null,
  });
}
