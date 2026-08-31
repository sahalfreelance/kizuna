import { supabaseAdmin } from "@/lib/supabase";

export const ALPHA_SECTIONS = ["TRENDING", "NEWS", "FEED"];

/**
 * Ambil item alpha dengan KUOTA PER SECTION, bukan satu jendela global.
 *
 * Kenapa: sebelumnya satu query `.limit(300)` lintas semua section, lalu
 * di-filter per section di client. FEED (tweets/notes) volumenya jauh lebih
 * tinggi dari TRENDING, jadi kalau forwarder baru masuk banyak, 300 item
 * terbaru bisa isinya FEED semua dan TRENDING tampil KOSONG walau datanya
 * ada di database. Polling `limit=100` bikin lebih parah: tiap 20 detik
 * daftar diganti 100 item terbaru, jadi TRENDING yang tadinya muncul bisa
 * hilang lagi.
 *
 * Satu query per section berarti tiap tab punya jatah sendiri dan tidak bisa
 * digusur tab lain.
 */
export async function fetchAlphaBySection(perSection = 100) {
  const results = await Promise.all(
    ALPHA_SECTIONS.map((section) =>
      supabaseAdmin
        .from("alpha_items")
        .select("*")
        .eq("section", section)
        // source_timestamp = waktu asli dari Alphagate, bukan waktu insert.
        // nullsFirst:false biar data lama tanpa timestamp nggak nongkrong di atas.
        .order("source_timestamp", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(perSection)
    )
  );

  const items = [];
  for (const [i, r] of results.entries()) {
    if (r.error) {
      console.error(`Gagal ambil alpha ${ALPHA_SECTIONS[i]}:`, r.error.message);
      continue;
    }
    items.push(...(r.data || []));
  }
  return items;
}
