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
    const accessToken = await exchangeCodeForToken(code, redirect_uri, code_verifier);
    const result = await verifyDiscordToken(accessToken);

    if (!result.user) {
      return NextResponse.json({ error: "Token Discord tidak valid" }, { status: 401 });
    }

    return NextResponse.json({ ...result, access_token: accessToken });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
