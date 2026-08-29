import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { PLATFORMS } from "@/lib/platforms";

/**
 * GET /api/aco/platforms
 *
 * Daftar platform ACO + status kesiapannya. Dipakai halaman /aco untuk
 * merender tab section dan menonaktifkan platform yang belum siap.
 */
export async function GET(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  return NextResponse.json({ data: PLATFORMS });
}
