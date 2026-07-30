import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import Navbar from "@/components/Navbar";
import AdminPanel from "@/components/AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  if (!session?.isAdmin) {
    redirect("/");
  }

  const { data } = await supabaseAdmin
    .from("garapan")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <>
      <Navbar session={session} />
      <AdminPanel initialEntries={data || []} />
    </>
  );
}
