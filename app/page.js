import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import Dashboard from "@/components/Dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  const { data, error } = await supabaseAdmin
    .from("garapan")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Gagal ambil data garapan:", error);
  }

  return (
    <>
      <Navbar session={session} />
      <Dashboard entries={data || []} />
    </>
  );
}
