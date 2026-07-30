"use client";
import { signIn } from "next-auth/react";

export default function LoginButton({ callbackUrl = "/" }) {
  return (
    <button
      onClick={() => signIn("discord", { callbackUrl })}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        background: "var(--indigo)",
        color: "#fff",
        border: "none",
        borderRadius: 5,
        padding: "12px 20px",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: 1,
        cursor: "pointer",
        transition: "opacity 0.15s",
      }}
      onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
      onMouseLeave={e => e.currentTarget.style.opacity = "1"}
    >
      <svg width="18" height="14" viewBox="0 0 24 20" fill="currentColor">
        <path d="M20.317 1.492a19.825 19.825 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 1.492a.07.07 0 00-.032.027C.533 6.093-.32 10.555.099 14.961a.08.08 0 00.031.055 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z"/>
      </svg>
      ./login_discord.sh
    </button>
  );
}
