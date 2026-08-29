import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { getOpenseaKeyStatus, ensureFreshOpenseaKey } from "@/lib/openseaKey";

/**
 * GET /api/aco/opensea-key
 *
 * Status API key OpenSea yang sedang dipakai. TIDAK mengembalikan key-nya,
 * hanya 4 karakter terakhir + umur + sisa hari.
 */
export async function GET(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  try {
    return NextResponse.json({ data: await getOpenseaKeyStatus() });
  } catch (err) {
    console.error("[aco/opensea-key] GET gagal:", err?.message ?? err);
    return NextResponse.json({ error: "Gagal ambil status key." }, { status: 500 });
  }
}

/**
 * POST /api/aco/opensea-key
 *
 * Paksa rotasi key. Admin saja.
 *
 * Perlu diketahui: OpenSea membatasi pembuatan key 2 per hari per IP. Kalau
 * kuota habis, respons akan bilang begitu dan key lama tetap dipakai.
 */
export async function POST(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse, { requireAdmin: true });
  if (denied) return denied;

  const result = await ensureFreshOpenseaKey();
  const status = await getOpenseaKeyStatus();

  return NextResponse.json({ data: { ...result, status } });
}
