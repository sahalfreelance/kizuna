import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabase";

const VALID_SECTIONS = ["TRENDING", "NEWS", "FEED"];
// Naik dari 100. Halaman /alpha memuat awal dengan limit 300, jadi batas 100
// di sini bikin polling mengembalikan lebih sedikit data daripada muatan
// awal -- section yang timestamp-nya paling tua (TRENDING) kepotong habis.
const MAX_LIMIT = 500;

// Dipakai halaman /alpha buat polling data (mirip /api/garapan).
// Auth-nya sama: harus member Discord House of Kizuna.
export async function GET(req) {
  const auth = await getAuthContext(req);

  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const section = searchParams.get("section");
  const source = searchParams.get("source");
  const category = searchParams.get("category");

  const rawLimit = parseInt(searchParams.get("limit") || "60", 10);
  const limit = Number.isNaN(rawLimit) ? 60 : Math.min(Math.max(rawLimit, 1), MAX_LIMIT);

  let query = supabaseAdmin
    .from("alpha_items")
    .select("*")
    // source_timestamp bisa null buat data lama -> nullsFirst:false biar yang
    // null nggak nongkrong di atas.
    .order("source_timestamp", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (section && VALID_SECTIONS.includes(section)) {
    query = query.eq("section", section);
  }
  if (source) {
    query = query.eq("source", source);
  }
  if (category) {
    query = query.eq("category", category);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
