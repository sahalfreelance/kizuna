"use client";
import { signOut } from "next-auth/react";

export default function SignOutButton({ label = "EXIT", style = {} }) {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      style={{
        background: "transparent",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: "4px 10px",
        fontSize: 11,
        color: "var(--text-mid)",
        letterSpacing: 1,
        cursor: "pointer",
        transition: "border-color 0.15s, color 0.15s",
        ...style,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "#7f1d1d"; e.currentTarget.style.color = "#f87171"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-dim)"; }}
    >
      {label}
    </button>
  );
}
