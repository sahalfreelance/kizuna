import { getPageSession } from "@/lib/pageSession";
import Navbar from "@/components/Navbar";
import AcoDashboard from "@/components/AcoDashboard";

export const dynamic = "force-dynamic";

export default function AcoPage() {
  const session = getPageSession();

  return (
    <>
      <Navbar session={session} />
      <AcoDashboard />
    </>
  );
}
