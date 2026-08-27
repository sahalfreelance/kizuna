import { getPageSession } from "@/lib/pageSession";
import Navbar from "@/components/Navbar";
import ComingSoon from "@/components/ComingSoon";

export default async function InscriptionPage() {
  const session = getPageSession();
  return (
    <>
      <Navbar session={session} />
      <ComingSoon
        label="root@kizuna: ~/inscription"
        title="Inscription"
        note="Section khusus buat tools/informasi Inscription lagi disiapin, terpisah dari ACO."
      />
    </>
  );
}
