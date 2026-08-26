import { NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/discordOAuth";
import { verifyDiscordToken, TokenStatus } from "@/lib/mobileAuth";

export async function POST(req) {
  const body = await req.json().catch(() => null);
  const { code, redirect_uri, code_verifier } = body || {};

  if (!code || !redirect_uri || !code_verifier) {
    return NextResponse.json(
      { error: "code, redirect_uri, dan code_verifier wajib diisi" },
      { status: 400 }
    );
  }

  let tokens;
  try {
    // PERUBAHAN: ambil seluruh payload token, bukan cuma access_token.
    // refresh_token dibutuhkan app supaya sesinya gak mati tiap 7 hari.
    tokens = await exchangeCodeForToken(code, redirect_uri, code_verifier);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const result = await verifyDiscordToken(tokens.access_token);

  if (result.status === TokenStatus.INVALID_TOKEN) {
    return NextResponse.json(
      { error: "Token Discord tidak valid" },
      { status: 401 }
    );
  }

  // PERUBAHAN PENTING: kalau Discord rate limit / gangguan saat mengecek
  // keanggotaan, JANGAN kirim isMember: false — app akan menampilkan
  // "Akses ditolak" padahal user sah. Ini penyebab login yang kadang
  // ditolak, kadang lolos kalau dicoba ulang.
  //
  // Token tetap dikirim supaya app bisa menyimpannya dan mencoba
  // verifikasi lagi tanpa mengulang seluruh alur OAuth.
  if (result.status === TokenStatus.UPSTREAM_ERROR) {
    return NextResponse.json(
      {
        error: "Tidak bisa memverifikasi keanggotaan saat ini. Coba lagi.",
        retryable: true,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_in: tokens.expires_in ?? null,
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    isMember: result.isMember,
    isAdmin: result.isAdmin,
    user: result.user,
    access_token: tokens.access_token,
    // Dua field di bawah ini yang baru. Kalau Discord tidak mengirim
    // refresh_token (mis. scope tidak mengizinkan), app tetap jalan —
    // cuma balik ke perilaku lama: sesi habis dalam ~7 hari.
    refresh_token: tokens.refresh_token ?? null,
    expires_in: tokens.expires_in ?? null,
  });
}
