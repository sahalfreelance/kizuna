"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignOutButton({ label = "EXIT", style = {} }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      // Cukup hapus cookie sesi di server. Device binding TIDAK dilepas —
      // logout bukan berarti pindah perangkat (itu pakai /reset-device di bot).
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Walaupun gagal (offline), tetap lanjut ke /login — cookie akan
      // ditolak middleware kalau memang sudah tidak sah.
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <button
      onClick={signOut}
      disabled={busy}
      style={{
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: "4px 10px",
        fontSize: 11,
        color: "var(--text-mid)",
        letterSpacing: 1,
        cursor: busy ? "wait" : "pointer",
        transition: "border-color 0.15s, color 0.15s",
        fontFamily: "var(--font-mono)",
        ...style,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "#7f1d1d"; e.currentTarget.style.color = "#f87171"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-dim)"; }}
    >
      {busy ? "..." : label}
    </button>
  );
}
