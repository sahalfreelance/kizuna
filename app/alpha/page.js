import { getPageSession } from "@/lib/pageSession";
import { fetchAlphaBySection } from "@/lib/alphaQuery";
import Navbar from "@/components/Navbar";
import AlphaDashboard from "@/components/AlphaDashboard";

export const dynamic = "force-dynamic";

export default async function AlphaPage() {
  const session = getPageSession();

  // Kuota per section: TRENDING tidak bisa digusur FEED yang volumenya tinggi.
  const items = await fetchAlphaBySection(100);

  return (
    <>
      <Navbar session={session} />
      <AlphaDashboard items={items} />
    </>
  );
}
