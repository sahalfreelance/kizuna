import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const VALID_CATEGORIES = ["CRYPTO", "NFT", "RAFFLE", "MINT"];

// Endpoint ini dipanggil oleh BOT (bukan user biasa), makanya autentikasinya
// pakai secret key di header, bukan session Discord OAuth.
// Dipakai buat semua channel yang di-listen bot: RAFFLE, NFT, AIRDROP, dst.
export async function POST(req) {
  const apiKey = req.headers.get("x-api-key");

  if (!apiKey || apiKey !== process.env.RAFFLE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { title, description, category, link, secondary_link, image_url, created_by, status, expires_at } = body;

  if (!title) {
    return NextResponse.json({ error: "title wajib diisi" }, { status: 400 });
  }
  if (!VALID_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "category tidak valid" }, { status: 400 });
  }

  const finalStatus =
    category === "RAFFLE"
      ? (["LIVE", "PAST"].includes(status) ? status : "LIVE")
      : null;

  const { data, error } = await supabaseAdmin
    .from("garapan")
    .insert({
      title: title.slice(0, 300),
      description: (description || "").slice(0, 2000),
      category,
      status: finalStatus,
      expires_at: category === "RAFFLE" ? (expires_at || null) : null,
      link: link || null,
      secondary_link: secondary_link || null,
      image_url: image_url || null,
      created_by: created_by || "discord-bot",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
