import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Eligibility check OpenSea drops.
 *
 * Website TIDAK memanggil OpenSea sendiri di sini. Alasannya field
 * eligibility (`isEligible`, `eligibleMaxTotalMintableByWallet`) dikunci di
 * balik auth — terverifikasi:
 *
 *     tanpa auth  -> UNAUTHORIZED @ stages.isEligible
 *     dengan SIWE -> field terbuka
 *
 * SIWE login butuh private key wallet, dan private key hanya didekripsi di
 * worker VPS. Jadi website cuma menitipkan permintaan ke tabel
 * `aco_elig_checks`, lalu browser polling hasilnya.
 */

// Batas agar satu user tidak menumpuk pengecekan dan menahan worker.
const MAX_PENDING = 3;

/**
 * POST /api/aco/eligibility
 * body: { slug, wallet_ids? }
 *
 * Bikin permintaan pengecekan. Balikan { id } untuk dipolling.
 */
export async function POST(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const slug = String(body?.slug || "").trim().toLowerCase();

  if (!slug || !/^[a-z0-9][a-z0-9-]{1,80}$/.test(slug)) {
    return NextResponse.json({ error: "Slug tidak valid." }, { status: 400 });
  }

  const walletIds = Array.isArray(body?.wallet_ids)
    ? body.wallet_ids.filter((id) => typeof id === "string").slice(0, 10)
    : [];

  // Kalau ada pengecekan yang sama masih berjalan, pakai itu saja daripada
  // membuat duplikat — user yang menekan CEK dua kali tidak boleh menggandakan
  // beban login SIWE.
  const { data: existing } = await supabaseAdmin
    .from("aco_elig_checks")
    .select("id, status")
    .eq("user_id", auth.userId)
    .eq("slug", slug)
    .in("status", ["QUEUED", "CLAIMED"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ data: { id: existing.id, reused: true } });
  }

  const { count } = await supabaseAdmin
    .from("aco_elig_checks")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .in("status", ["QUEUED", "CLAIMED"]);

  if ((count ?? 0) >= MAX_PENDING) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_PENDING} pengecekan berjalan. Tunggu yang lain selesai.` },
      { status: 429 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("aco_elig_checks")
    .insert({
      user_id: auth.userId,
      slug,
      platform: "opensea",
      wallet_ids: walletIds,
    })
    .select("id, status, created_at")
    .single();

  if (error) {
    // Tabel belum ada = migration belum dijalankan. Dibedakan supaya pesannya
    // berguna, bukan cuma "gagal".
    if (error.code === "42P01") {
      return NextResponse.json(
        {
          error:
            "Tabel eligibility belum ada. Jalankan supabase/migration_aco_eligibility.sql.",
          code: "MIGRATION_MISSING",
        },
        { status: 503 }
      );
    }
    console.error("[aco/eligibility] insert gagal:", error.message);
    return NextResponse.json({ error: "Gagal bikin pengecekan." }, { status: 500 });
  }

  return NextResponse.json({ data });
}

/**
 * GET /api/aco/eligibility?id=<uuid>
 *   atau
 * GET /api/aco/eligibility?slug=<slug>   -> hasil terakhir untuk slug itu
 *
 * Dipakai browser untuk polling sampai status DONE / FAILED.
 */
export async function GET(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const slug = searchParams.get("slug");

  let query = supabaseAdmin
    .from("aco_elig_checks")
    .select("id, slug, status, result, error_message, created_at, finished_at")
    .eq("user_id", auth.userId);

  if (id) {
    query = query.eq("id", id);
  } else if (slug) {
    query = query.eq("slug", String(slug).toLowerCase());
  } else {
    return NextResponse.json({ error: "Butuh id atau slug." }, { status: 400 });
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") {
      return NextResponse.json(
        { error: "Tabel eligibility belum ada.", code: "MIGRATION_MISSING" },
        { status: 503 }
      );
    }
    console.error("[aco/eligibility] GET gagal:", error.message);
    return NextResponse.json({ error: "Gagal ambil hasil." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ data: null });
  }

  return NextResponse.json({ data });
}
