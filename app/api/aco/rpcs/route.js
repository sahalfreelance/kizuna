import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabase";
import { encryptPrivateKey } from "@/lib/walletCrypto";
import { SUPPORTED_CHAINS, isSupportedChain, validateRpcUrl } from "@/lib/chains";

/**
 * GET /api/aco/rpcs
 *
 * Daftar chain yang didukung + RPC milik user untuk masing-masing.
 *
 * `encrypted_url` TIDAK di-select. RPC URL sering mengandung API key di
 * path-nya (Alchemy/Infura), jadi diperlakukan rahasia — yang dikirim ke
 * browser hanya hostname-nya supaya user tahu ini RPC yang mana.
 */
export async function GET(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from("aco_rpcs")
    .select("id, chain, display_host, updated_at")
    .eq("user_id", auth.userId);

  if (error) {
    console.error("[aco/rpcs] GET gagal:", error.message);
    return NextResponse.json({ error: "Gagal ambil daftar RPC." }, { status: 500 });
  }

  const byChain = new Map((data || []).map((r) => [r.chain, r]));

  return NextResponse.json({
    data: SUPPORTED_CHAINS.map((c) => {
      const custom = byChain.get(c.identifier);
      return {
        identifier: c.identifier,
        chainId: c.chainId,
        label: c.label,
        symbol: c.symbol,
        // Ini cuma indikator UI. RPC default dipakai kalau user belum
        // menyimpan RPC sendiri.
        hasCustomRpc: Boolean(custom),
        customHost: custom?.display_host ?? null,
        updatedAt: custom?.updated_at ?? null,
      };
    }),
  });
}

/**
 * POST /api/aco/rpcs
 * body: { chain, rpc_url }
 *
 * Simpan/ganti RPC untuk satu chain. Upsert — satu user satu RPC per chain.
 */
export async function POST(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const chain = String(body?.chain || "").toLowerCase();

  if (!isSupportedChain(chain)) {
    return NextResponse.json(
      { error: "Chain tidak didukung." },
      { status: 400 }
    );
  }

  // validateRpcUrl juga menolak alamat internal (localhost, 10.x, 192.168.x,
  // 169.254.x). Tanpa itu, endpoint ini bisa dipakai memindai jaringan
  // internal VPS lewat worker — SSRF.
  const check = validateRpcUrl(body?.rpc_url);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("aco_rpcs")
    .upsert(
      {
        user_id: auth.userId,
        chain,
        encrypted_url: encryptPrivateKey(check.url),
        display_host: check.host,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,chain" }
    )
    .select("id, chain, display_host, updated_at")
    .single();

  if (error) {
    console.error("[aco/rpcs] upsert gagal:", error.message);
    return NextResponse.json({ error: "Gagal simpan RPC." }, { status: 500 });
  }

  return NextResponse.json({ data });
}

/**
 * DELETE /api/aco/rpcs?chain=<chain>
 *
 * Hapus RPC custom; chain itu kembali memakai RPC default.
 */
export async function DELETE(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const chain = String(searchParams.get("chain") || "").toLowerCase();

  if (!isSupportedChain(chain)) {
    return NextResponse.json({ error: "Chain tidak didukung." }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("aco_rpcs")
    .delete()
    .eq("user_id", auth.userId)
    .eq("chain", chain);

  if (error) {
    console.error("[aco/rpcs] DELETE gagal:", error.message);
    return NextResponse.json({ error: "Gagal hapus RPC." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
