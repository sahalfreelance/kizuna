import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabase";

// MINT ditambahkan: bot sudah mengirim kategori ini (lihat bot/garapan-bot.js
// MINT_CHANNEL_ID), tapi daftar ini belum memuatnya — jadi POST manual
// dengan category MINT ditolak 400 padahal datanya sah.
const VALID_CATEGORIES = ["CRYPTO", "NFT", "RAFFLE", "AIRDROP", "MINT"];
const VALID_STATUSES = ["LIVE", "PAST"];

export async function GET(req) {
  const auth = await getAuthContext(req);

  // PERUBAHAN: dulu semua kegagalan -> 401 Unauthorized, termasuk saat
  // Discord rate limit. App mobile menganggap 401 = sesi mati, membuang
  // token, lalu menampilkan "Sesi berakhir". Sekarang gangguan Discord
  // dibalas 503 (retryable) supaya sesi user tidak dihapus.
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from("garapan")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function POST(req) {
  const auth = await getAuthContext(req);

  const denied = buildDenial(auth, NextResponse, { requireAdmin: true });
  if (denied) return denied;

  const body = await req.json();
  const { title, description, category, status, link, image_url } = body;

  if (!title || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "Data tidak valid" }, { status: 400 });
  }
  if (category === "RAFFLE" && !VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: "Raffle wajib punya status LIVE atau PAST" },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("garapan")
    .insert({
      title,
      description: description || "",
      category,
      status: category === "RAFFLE" ? status : null,
      link: link || null,
      image_url: image_url || null,
      created_by: auth.username,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}
