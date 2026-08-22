import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabase";

// MINT ditambahkan agar konsisten dengan bot & route /api/garapan.
const VALID_CATEGORIES = ["CRYPTO", "NFT", "RAFFLE", "AIRDROP", "MINT"];
const VALID_STATUSES = ["LIVE", "PAST"];

export async function PUT(req, { params }) {
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
    .update({
      title,
      description: description || "",
      category,
      status: category === "RAFFLE" ? status : null,
      link: link || null,
      image_url: image_url || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function DELETE(req, { params }) {
  const auth = await getAuthContext(req);

  const denied = buildDenial(auth, NextResponse, { requireAdmin: true });
  if (denied) return denied;

  const { error } = await supabaseAdmin
    .from("garapan")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
