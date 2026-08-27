import { getPageSession } from "@/lib/pageSession";
import Navbar from "@/components/Navbar";
import ComingSoon from "@/components/ComingSoon";

export default async function AcoPage() {
  const session = getPageSession();
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
