import SignOutButton from "@/components/SignOutButton";

export default function NotMemberPage() {
  return (
    <main style={{
      minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 24,
    }}>
      <div style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderTop: "2px solid #f87171",
        borderRadius: 8,
        padding: "36px 40px",
        maxWidth: 440, width: "100%",
      }}>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 20, lineHeight: 2 }}>
          <div><span style={{ color: "#f87171" }}>✗</span> Access denied: not a member</div>
          <div><span style={{ color: "#f87171" }}>✗</span> Insufficient privilege level</div>
          <div><span style={{ color: "var(--text-dim)" }}>$</span> Run join_server.sh to continue</div>
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>403 — Forbidden</h1>
        <p style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 24, lineHeight: 1.7 }}>
          Akun Discord lo belum bergabung di server komunitas.<br />
          Join dulu baru bisa akses log board ini.
        </p>
        <SignOutButton
          label="← back to login"
          style={{ display: "inline-block", padding: "8px 16px", fontSize: 12 }}
        />
      </div>
    </main>
  );
}
