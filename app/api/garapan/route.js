import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

const VALID_CATEGORIES = ["CRYPTO", "NFT", "RAFFLE", "MINT"];
const VALID_STATUSES = ["LIVE", "PAST"];

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.isMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
  const session = await getServerSession(authOptions);
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { title, description, category, status, link, secondary_link, image_url } = body;

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
      secondary_link: secondary_link || null,
      image_url: image_url || null,
      created_by: session.user.name,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}
