import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";

/**
 * GET /api/auth/me
 *
 * Dipakai app Android & web buat cek "sesi gw masih hidup nggak?" tanpa
 * mengulang login. Menggantikan /api/auth/verify yang khusus token Discord.
 *
 *   200 -> { user: { username, isAdmin, isMember } }
 *   401 -> sesi mati, perlu login ulang
 *   403 -> DEVICE_MISMATCH (token dipakai dari perangkat lain)
 *   503 -> gangguan sementara, JANGAN buang token
 */
export async function GET(req) {
  const auth = await getAuthContext(req);

  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  return NextResponse.json({
    user: {
      username: auth.username,
      isAdmin: auth.isAdmin,
      isMember: auth.isMember,
    },
    authType: auth.authType || "local",
  });
}
