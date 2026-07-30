import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import ComingSoon from "@/components/ComingSoon";

export default async function InscriptionPage() {
  const session = await getServerSession(authOptions);
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
