import Link from "next/link";
import SignOutButton from "./SignOutButton";

export default function Navbar({ session }) {
  return (
    <header style={{
      position: "sticky",
      top: 0,
      zIndex: 100,
      background: "rgba(7,9,15,0.92)",
      backdropFilter: "blur(8px)",
      borderBottom: "1px solid var(--border)",
    }}>
      {/* terminal title bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 20px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg2)",
      }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57", display: "inline-block" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e", display: "inline-block" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840", display: "inline-block" }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-dim)", letterSpacing: 1 }}>
          house-of-kizuna — bash
        </span>
      </div>

      {/* nav row + toolbar, disatuin dalam 1 baris */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 20px",
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <img
              src="/logo.jpg"
              alt="House of Kizuna"
              style={{ width: 20, height: 20, borderRadius: 5, display: "block" }}
            />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1, color: "var(--text)", whiteSpace: "nowrap" }}>
              HOUSE OF <span style={{ color: "var(--indigo-hi)" }}>KIZUNA</span>
            </span>
          </Link>

          <div style={{ display: "flex", alignItems: "center", gap: 4, overflowX: "auto" }}>
            {[
              { href: "/", label: "OVERVIEW" },
              { href: "/alpha", label: "ALPHA" },
              { href: "/aco", label: "ACO" },
              { href: "/inscription", label: "INSCRIPTION" },
              { href: "/collab-request", label: "REQUEST COLLAB" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  fontSize: 10.5,
                  letterSpacing: 1,
                  color: "var(--text-dim)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  padding: "4px 9px",
                  whiteSpace: "nowrap",
                  transition: "color 0.15s, border-color 0.15s",
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {session?.isAdmin && (
            <Link href="/admin" style={{
              fontSize: 12,
              color: "var(--live)",
              border: "1px solid var(--live)",
              borderRadius: 4,
              padding: "4px 10px",
              letterSpacing: 1,
              opacity: 0.85,
            }}>
              ROOT
            </Link>
          )}
          {session?.user?.name && (
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
              <span style={{ color: "var(--indigo-dim)" }}>@</span>{session.user.name}
            </span>
          )}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
