import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabase";

const MAX_ACTIVE_JOBS = 3;

/**
 * GET /api/aco/jobs
 *
 * Daftar job milik user. Dipakai halaman /aco buat polling status.
 */
export async function GET(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10) || 20, 50);

  const { data, error } = await supabaseAdmin
    .from("aco_jobs")
    .select("*")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[aco/jobs] GET gagal:", error.message);
    return NextResponse.json({ error: "Gagal ambil daftar job." }, { status: 500 });
  }

  return NextResponse.json({ data });
}

/**
 * POST /api/aco/jobs
 * body: {
 *   slug, contract_address, chain,
 *   stage: { stageIndex, label, stageType, startTime, endTime, priceUnit },
 *   mint_amount, gas_limit, wallet_ids: []
 * }
 *
 * Job dibuat dengan status QUEUED. Worker VPS yang mengeksekusi.
 */
export async function POST(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const body = await req.json().catch(() => null);

  const slug = String(body?.slug || "").trim().toLowerCase();
  if (!slug) {
    return NextResponse.json({ error: "Slug collection wajib diisi." }, { status: 400 });
  }

  const walletIds = Array.isArray(body?.wallet_ids) ? body.wallet_ids : [];
  if (walletIds.length === 0) {
    return NextResponse.json({ error: "Pilih minimal satu wallet." }, { status: 400 });
  }

  // Pastikan SEMUA wallet yang dikirim benar-benar milik user ini. Tanpa cek
  // ini, user bisa menjalankan mint memakai wallet orang lain cuma dengan
  // menebak/menyalin UUID-nya.
  const { data: owned, error: walletError } = await supabaseAdmin
    .from("aco_wallets")
    .select("id")
    .eq("user_id", auth.userId)
    .eq("is_active", true)
    .in("id", walletIds);

  if (walletError) {
    console.error("[aco/jobs] cek wallet gagal:", walletError.message);
    return NextResponse.json({ error: "Gagal validasi wallet." }, { status: 500 });
  }

  const ownedIds = (owned || []).map((w) => w.id);
  if (ownedIds.length !== walletIds.length) {
    return NextResponse.json(
      { error: "Ada wallet yang tidak valid atau bukan milik kamu." },
      { status: 403 }
    );
  }

  // Batas job aktif: mencegah user menumpuk puluhan job yang bikin worker
  // (yang jalan sequential) tidak kebagian slot untuk user lain.
  const { count, error: countError } = await supabaseAdmin
    .from("aco_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .in("status", ["QUEUED", "CLAIMED", "RUNNING"]);

  if (countError) {
    console.error("[aco/jobs] count gagal:", countError.message);
    return NextResponse.json({ error: "Gagal cek job aktif." }, { status: 500 });
  }

  if ((count ?? 0) >= MAX_ACTIVE_JOBS) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_ACTIVE_JOBS} job aktif. Tunggu yang lain selesai atau batalkan dulu.` },
      { status: 400 }
    );
  }

  const stage = body?.stage || {};
  const mintAmount = Math.max(1, Math.min(parseInt(body?.mint_amount, 10) || 1, 100));
  const gasLimit = Math.max(21000, Math.min(parseInt(body?.gas_limit, 10) || 300000, 5000000));

  const { data, error } = await supabaseAdmin
    .from("aco_jobs")
    .insert({
      user_id: auth.userId,
      slug,
      contract_address: body?.contract_address || null,
      chain: body?.chain || null,
      stage_index: Number.isInteger(stage.stageIndex) ? stage.stageIndex : null,
      stage_label: stage.label || null,
      stage_type: stage.stageType || null,
      stage_start_time: stage.startTime || null,
      stage_end_time: stage.endTime || null,
      price_unit: stage.priceUnit != null ? String(stage.priceUnit) : null,
      mint_amount: mintAmount,
      gas_limit: gasLimit,
      wallet_ids: ownedIds,
      status: "QUEUED",
    })
    .select("*")
    .single();

  if (error) {
    console.error("[aco/jobs] insert gagal:", error.message);
    return NextResponse.json({ error: "Gagal bikin job." }, { status: 500 });
  }

  return NextResponse.json({ data });
}
