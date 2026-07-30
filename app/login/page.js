import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import LoginButton from "@/components/LoginButton";

export default async function LoginPage({ searchParams }) {
  const session    = await getServerSession(authOptions);
  const callbackUrl = searchParams?.callbackUrl || "/";

  if (session) {
    redirect(session.isMember ? callbackUrl : "/not-member");
  }

  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      position: "relative",
      overflow: "hidden",
    }}>
      {/* background grid */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 0,
        backgroundImage: `
          linear-gradient(rgba(79,70,229,0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(79,70,229,0.04) 1px, transparent 1px)
        `,
        backgroundSize: "40px 40px",
      }} />

      {/* glow */}
      <div style={{
        position: "absolute", top: "40%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 400, height: 400, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(79,70,229,0.12) 0%, transparent 70%)",
        zIndex: 0,
      }} />

      <div style={{
        position: "relative", zIndex: 1,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderTop: "2px solid var(--indigo)",
        borderRadius: 8,
        padding: "36px 40px",
        maxWidth: 440, width: "100%",
        textAlign: "left",
      }}>
        {/* terminal title bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          marginBottom: 24, paddingBottom: 16,
          borderBottom: "1px solid var(--border)",
        }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ff5f57", display: "inline-block" }} />
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#febc2e", display: "inline-block" }} />
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#28c840", display: "inline-block" }} />
          <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-dim)", letterSpacing: 1 }}>
            auth — ssh kizuna
          </span>
        </div>

        {/* boot lines */}
        <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 2, marginBottom: 20 }}>
          <div><span style={{ color: "var(--indigo-dim)" }}>$</span> Checking membership status...</div>
          <div><span style={{ color: "#f87171" }}>✗</span> Unauthorized. Authentication required.</div>
          <div><span style={{ color: "var(--indigo-dim)" }}>$</span> Initiating Discord OAuth...</div>
        </div>

        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 8, letterSpacing: 0.3 }}>
          Access Terminal
        </h1>
        <p style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 24, lineHeight: 1.7 }}>
          Log board ini cuma buat anggota server.<br />
          Login pakai akun Discord yang udah gabung di komunitas.
        </p>

        <LoginButton callbackUrl={callbackUrl} />
      </div>
    </main>
  );
}
