import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const VALID_SECTIONS = ["TRENDING", "NEWS", "FEED"];
const VALID_SOURCES = ["trending", "launches", "summary", "notes", "tweets"];
const VALID_CATEGORIES = ["NFT", "CRYPTO"];

// Endpoint ini dipanggil forwarder Alphagate (bukan user biasa), autentikasi
// pakai secret key di header -- sama pola dengan /api/webhook/garapan.
//
// Kenapa batch (array), bukan satu-satu kayak webhook garapan? Karena satu run
// forwarder bisa bawa 100+ item; kalau dikirim satu request per item, Vercel
// function invocation-nya kebakar dan lambat. Di sini sekali POST bisa ratusan.
export async function POST(req) {
  const apiKey = req.headers.get("x-api-key");

  if (!apiKey || apiKey !== process.env.RAFFLE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON valid" }, { status: 400 });
  }

  const items = Array.isArray(body) ? body : body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "Kirim array item, atau { items: [...] }" },
      { status: 400 }
    );
  }

  const rows = [];
  const rejected = [];

  for (const raw of items) {
    const problem = validate(raw);
    if (problem) {
      rejected.push({ source_id: raw?.source_id ?? null, reason: problem });
      continue;
    }
    rows.push(normalize(raw));
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Tidak ada item yang valid", rejected },
      { status: 400 }
    );
  }

  // upsert on source_id: item yang udah ada di-update (metrik followers &
  // growth berubah terus), bukan bikin baris baru. Ini yang bikin "gak boleh
  // ada data double" beneran kejaga walaupun forwarder jalan tiap 15 menit.
  const { data: upserted, error } = await supabaseAdmin
    .from("alpha_items")
    .upsert(rows, { onConflict: "source_id", ignoreDuplicates: false })
    .select("id, source_id, section, source, category, pushed_to_garapan");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Kategori NFT ikut masuk tabel `garapan` biar nongol di dashboard utama.
  // Yang udah pernah di-push dilewati -> nggak dobel.
  const nftPending = (upserted || []).filter(
    (row) => row.category === "NFT" && !row.pushed_to_garapan
  );

  const pushResult = await pushNftToGarapan(nftPending, rows);

  return NextResponse.json({
    received: items.length,
    saved: upserted?.length ?? 0,
    pushed_to_garapan: pushResult.inserted,
    push_skipped: pushResult.skipped,
    rejected,
  });
}

function validate(raw) {
  if (!raw || typeof raw !== "object") return "bukan object";
  if (!raw.source_id) return "source_id wajib diisi";
  if (!raw.title) return "title wajib diisi";
  if (!VALID_SECTIONS.includes(raw.section)) return `section tidak valid: ${raw.section}`;
  if (!VALID_SOURCES.includes(raw.source)) return `source tidak valid: ${raw.source}`;
  if (raw.category && !VALID_CATEGORIES.includes(raw.category)) {
    return `category tidak valid: ${raw.category}`;
  }
  return null;
}

function asArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.trim()).slice(0, 20);
}

function asInt(value) {
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

function normalize(raw) {
  const growth = raw.growth || {};

  return {
    section: raw.section,
    source: raw.source,
    source_id: String(raw.source_id).slice(0, 200),
    title: String(raw.title).slice(0, 300),
    description: String(raw.description || "").slice(0, 2000),
    username: raw.username ? String(raw.username).slice(0, 100) : null,
    display_name: raw.display_name ? String(raw.display_name).slice(0, 200) : null,
    avatar_url: raw.avatar_url || null,
    image_url: raw.image_url || null,
    link: raw.link || null,
    secondary_link: raw.secondary_link || null,
    followers_count: asInt(raw.followers_count),
    key_followers_count: asInt(raw.key_followers_count),
    followers_when_found: asInt(raw.followers_when_found),
    key_followers_growth_1d: asInt(growth.d1),
    key_followers_growth_3d: asInt(growth.d3),
    key_followers_growth_7d: asInt(growth.d7),
    tags: asArray(raw.tags),
    chains: asArray(raw.chains),
    contracts: asArray(raw.contracts),
    category: raw.category || null,
    source_timestamp: raw.source_timestamp || null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Salin item NFT ke tabel `garapan`.
 *
 * Anti-duplikat pakai kolom `garapan.source_id` yang punya UNIQUE index, jadi
 * dedup-nya dijaga DATABASE -- bukan cuma cek 5 menit terakhir kayak webhook
 * garapan yang lama (itu nggak nolong kalau cron jalan tiap 15 menit).
 */
async function pushNftToGarapan(pendingRows, allRows) {
  if (pendingRows.length === 0) return { inserted: 0, skipped: 0 };

  const bySourceId = new Map(allRows.map((r) => [r.source_id, r]));

  const candidates = pendingRows
    .map((row) => bySourceId.get(row.source_id))
    .filter(Boolean);

  // Cek mana yang udah ada di garapan (misal baris alpha_items-nya kehapus
  // tapi garapan-nya masih ada, atau flag pushed_to_garapan ke-reset).
  const ids = candidates.map((c) => c.source_id);
  const { data: existing } = await supabaseAdmin
    .from("garapan")
    .select("source_id")
    .in("source_id", ids);

  const already = new Set((existing || []).map((e) => e.source_id));
  const fresh = candidates.filter((c) => !already.has(c.source_id));

  if (fresh.length === 0) {
    return { inserted: 0, skipped: candidates.length };
  }

  const payload = fresh.map((c) => ({
    title: c.title,
    description: c.description,
    category: "NFT",
    status: null,
    expires_at: null,
    link: c.link,
    secondary_link: c.secondary_link,
    image_url: c.image_url || c.avatar_url,
    created_by: "alphagate",
    source_id: c.source_id,
  }));

  const { data: inserted, error } = await supabaseAdmin
    .from("garapan")
    .insert(payload)
    .select("source_id");

  if (error) {
    // Jangan gagalkan seluruh request cuma karena push ke garapan gagal --
    // data di alpha_items udah aman tersimpan.
    console.error("Gagal push NFT ke garapan:", error.message);
    return { inserted: 0, skipped: candidates.length, error: error.message };
  }

  const doneIds = (inserted || []).map((r) => r.source_id);
  if (doneIds.length > 0) {
    await supabaseAdmin
      .from("alpha_items")
      .update({ pushed_to_garapan: true })
      .in("source_id", doneIds);
  }

  return {
    inserted: doneIds.length,
    skipped: candidates.length - doneIds.length,
  };
}
