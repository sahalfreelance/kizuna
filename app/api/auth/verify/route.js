import { NextResponse } from "next/server";
import { verifyDiscordToken } from "@/lib/mobileAuth";

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

  if (!result.user) {
    return NextResponse.json(
      { error: "Token Discord tidak valid" },
      { status: 401 }
    );
  }

  return NextResponse.json(result);
}
