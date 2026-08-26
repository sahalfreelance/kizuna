import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import AlphaDashboard from "@/components/AlphaDashboard";

export const dynamic = "force-dynamic";

export default async function AlphaPage() {
  const session = await getServerSession(authOptions);

  const { data, error } = await supabaseAdmin
    .from("alpha_items")
    .select("*")
    // source_timestamp = waktu asli dari Alphagate, bukan waktu insert.
    // nullsFirst:false biar data lama tanpa timestamp nggak nongkrong di atas.
    .order("source_timestamp", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    console.error("Gagal ambil data alpha:", error.message);
  }

  return (
    <>
      <Navbar session={session} />
      <AlphaDashboard items={data || []} />
    </>
  );
}
