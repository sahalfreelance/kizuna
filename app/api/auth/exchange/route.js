import { NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/discordOAuth";
import { verifyDiscordToken } from "@/lib/mobileAuth";

export async function POST(req) {
  const body = await req.json().catch(() => null);
  const { code, redirect_uri, code_verifier } = body || {};

  if (!code || !redirect_uri || !code_verifier) {
    return NextResponse.json(
      { error: "code, redirect_uri, dan code_verifier wajib diisi" },
      { status: 400 }
    );
  }

  try {
    // PERUBAHAN: ambil seluruh payload token, bukan cuma access_token.
    // refresh_token dibutuhkan app supaya sesinya gak mati tiap 7 hari.
    const tokens = await exchangeCodeForToken(code, redirect_uri, code_verifier);
    const result = await verifyDiscordToken(tokens.access_token);

    if (!result.user) {
      return NextResponse.json(
        { error: "Token Discord tidak valid" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      ...result,
      access_token: tokens.access_token,
      // Dua field di bawah ini yang baru. Kalau Discord tidak mengirim
      // refresh_token (mis. scope tidak mengizinkan), app tetap jalan —
      // cuma balik ke perilaku lama: sesi habis dalam ~7 hari.
      refresh_token: tokens.refresh_token ?? null,
      expires_in: tokens.expires_in ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
