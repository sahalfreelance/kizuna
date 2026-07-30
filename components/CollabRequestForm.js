"use client";

import { useState } from "react";

const EMPTY = {
  projectName: "", contactName: "", email: "",
  discordHandle: "", website: "", twitter: "", message: "",
  company: "", // honeypot
};

export default function CollabRequestForm() {
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error
  const [errorMsg, setErrorMsg] = useState("");

  const inputStyle = {
    width: "100%",
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "10px 12px",
    color: "var(--text)",
    fontSize: 13.5,
    fontFamily: "var(--font-sans)",
  };
  const labelStyle = { fontSize: 11, color: "var(--text-dim)", letterSpacing: 1, display: "block", marginBottom: 4 };

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/collab-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setErrorMsg(json.error || "Gagal mengirim.");
        setStatus("error");
        return;
      }
      setStatus("sent");
      setForm(EMPTY);
    } catch {
      setErrorMsg("Terjadi kesalahan jaringan.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div style={{
        border: "1px solid var(--crypto)", borderRadius: 6,
        padding: "24px 18px", textAlign: "center",
      }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>✅</div>
        <div style={{ color: "var(--crypto)", fontWeight: 600, marginBottom: 6 }}>Request terkirim!</div>
        <p style={{ fontSize: 13, color: "var(--text-dim)", margin: 0 }}>
          Makasih udah tertarik collab sama kami. Tim kami bakal follow up
          lewat email yang kalian kasih.
        </p>
        <button
          onClick={() => setStatus("idle")}
          style={{
            marginTop: 16, background: "transparent", border: "1px solid var(--border)",
            borderRadius: 6, padding: "8px 16px", fontSize: 12, color: "var(--text-mid)", cursor: "pointer",
          }}
        >
          Kirim request lain
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
      {/* honeypot, disembunyiin dari user beneran */}
      <input
        type="text"
        name="company"
        value={form.company}
        onChange={(e) => setForm({ ...form, company: e.target.value })}
        tabIndex={-1}
        autoComplete="off"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0 }}
      />

      <div>
        <label style={labelStyle}>NAMA PROJECT *</label>
        <input
          style={inputStyle}
          value={form.projectName}
          onChange={(e) => setForm({ ...form, projectName: e.target.value })}
          placeholder="Nama project/komunitas kalian"
          required
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>NAMA CONTACT PERSON *</label>
          <input
            style={inputStyle}
            value={form.contactName}
            onChange={(e) => setForm({ ...form, contactName: e.target.value })}
            placeholder="Nama kalian"
            required
          />
        </div>
        <div>
          <label style={labelStyle}>EMAIL *</label>
          <input
            type="email"
            style={inputStyle}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="email@contoh.com"
            required
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={labelStyle}>DISCORD (opsional)</label>
          <input
            style={inputStyle}
            value={form.discordHandle}
            onChange={(e) => setForm({ ...form, discordHandle: e.target.value })}
            placeholder="username#0000"
          />
        </div>
        <div>
          <label style={labelStyle}>TWITTER/X (opsional)</label>
          <input
            style={inputStyle}
            value={form.twitter}
            onChange={(e) => setForm({ ...form, twitter: e.target.value })}
            placeholder="https://x.com/..."
          />
        </div>
      </div>

      <div>
        <label style={labelStyle}>WEBSITE (opsional)</label>
        <input
          style={inputStyle}
          value={form.website}
          onChange={(e) => setForm({ ...form, website: e.target.value })}
          placeholder="https://..."
        />
      </div>

      <div>
        <label style={labelStyle}>DETAIL COLLAB *</label>
        <textarea
          style={{ ...inputStyle, minHeight: 100, resize: "vertical" }}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
          placeholder="Ceritain project kalian & bentuk collab yang diinginkan"
          required
        />
      </div>

      {errorMsg && (
        <div style={{ color: "#f87171", fontSize: 12 }}>{errorMsg}</div>
      )}

      <button
        type="submit"
        disabled={status === "sending"}
        style={{
          background: "var(--indigo)",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "12px 18px",
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.5,
          cursor: "pointer",
          opacity: status === "sending" ? 0.6 : 1,
        }}
      >
        {status === "sending" ? "Mengirim..." : "Kirim Request Collab"}
      </button>
    </form>
  );
}
