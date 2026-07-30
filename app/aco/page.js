import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Navbar from "@/components/Navbar";
import ComingSoon from "@/components/ComingSoon";

export default async function AcoPage() {
  const session = await getServerSession(authOptions);
  return (
    <>
      <Navbar session={session} />
      <ComingSoon
        label="root@kizuna: ~/aco"
        title="Auto Checkout (ACO)"
        note="Fitur checkout otomatis buat mint/raffle lagi disiapin. Section ini bakal punya halamannya sendiri, terpisah dari Inscription."
      />
    </>
  );
}
