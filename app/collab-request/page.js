import Link from "next/link";
import CollabRequestForm from "@/components/CollabRequestForm";

export const metadata = {
  title: "Request Collab — House of Kizuna",
};

export default function CollabRequestPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 20px 80px",
      }}
    >
      <div style={{ maxWidth: 560, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, width: "fit-content" }}>
            <img src="/logo.jpg" alt="House of Kizuna" style={{ width: 22, height: 22, borderRadius: 5 }} />
            <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: 1, color: "var(--text)" }}>
              HOUSE OF <span style={{ color: "var(--indigo-hi)" }}>KIZUNA</span>
            </span>
          </Link>

          <Link href="/" style={{
            fontSize: 12,
            color: "var(--text-dim)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "6px 12px",
            letterSpacing: 0.5,
          }}>
            ← Kembali ke beranda
          </Link>
        </div>

        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderTop: "2px solid var(--indigo)",
            borderRadius: 8,
            overflow: "hidden",
            boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
          }}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--bg2)",
          }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
            <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-dim)", letterSpacing: 1 }}>
              public — ~/collab_request.sh
            </span>
          </div>

          <div style={{ padding: "28px 32px" }}>
            <div style={{ fontSize: 11, color: "var(--indigo-dim)", letterSpacing: 2, marginBottom: 8 }}>
              PUBLIC FORM · GAK PERLU LOGIN
            </div>
            <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Request Collab</h1>
            <p style={{ fontSize: 13, color: "var(--text-dim)", margin: "0 0 24px", lineHeight: 1.6 }}>
              Punya project dan mau collab sama House of Kizuna? Isi form di bawah,
              tim kami bakal dapet notifikasi & follow up lewat email kalian.
            </p>

            <CollabRequestForm />
          </div>
        </div>
      </div>
    </main>
  );
}
