"use client";

import { useState } from "react";
import TerminalWindow from "./TerminalWindow";
import { getEffectiveStatus } from "@/lib/raffleStatus";

const EMPTY_FORM = {
  id: null, title: "", description: "",
  category: "CRYPTO", status: "LIVE", link: "", secondary_link: "", image_url: "",
};

const labelStyle = {
  fontSize: 11, color: "var(--indigo-dim)", letterSpacing: 1,
  display: "block", marginBottom: 5,
};

const inputStyle = {
  width: "100%",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "9px 12px",
  color: "var(--text)",
  fontSize: 13,
  fontFamily: "var(--font-mono)",
  outline: "none",
  transition: "border-color 0.15s",
};

export default function AdminPanel({ initialEntries }) {
  const [entries, setEntries] = useState(initialEntries);
  const [form, setForm]       = useState(EMPTY_FORM);
  const [saving, setSaving]   = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const isEditing = Boolean(form.id);

  function resetForm() { setForm(EMPTY_FORM); setErrorMsg(""); }

  function startEdit(entry) {
    setForm({
      id: entry.id, title: entry.title, description: entry.description || "",
      category: entry.category, status: entry.status || "LIVE",
      link: entry.link || "", secondary_link: entry.secondary_link || "", image_url: entry.image_url || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setErrorMsg("");
    const url    = isEditing ? `/api/garapan/${form.id}` : "/api/garapan";
    const method = isEditing ? "PUT" : "POST";
    try {
      const res  = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const json = await res.json();
      if (!res.ok) { setErrorMsg(json.error || "Gagal menyimpan."); setSaving(false); return; }
      setEntries(prev => isEditing ? prev.map(it => it.id === json.data.id ? json.data : it) : [json.data, ...prev]);
      resetForm();
    } catch { setErrorMsg("Terjadi kesalahan jaringan."); }
    finally  { setSaving(false); }
  }

  async function handleDelete(id) {
    if (!confirm("Hapus garapan ini?")) return;
    const res = await fetch(`/api/garapan/${id}`, { method: "DELETE" });
    if (res.ok) { setEntries(prev => prev.filter(it => it.id !== id)); if (form.id === id) resetForm(); }
  }

  return (
    <main style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 20px 80px" }}>
      <TerminalWindow label="root@kizuna: ~/admin_panel.sh" accent={isEditing ? "var(--live)" : "var(--indigo)"}>

      {/* header */}
      <div style={{ marginBottom: 28, paddingBottom: 18, borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: 2, marginBottom: 6 }}>
          <span style={{ color: "var(--live)" }}>root@kizuna</span>
          <span style={{ color: "var(--text-dim)" }}>:~#</span>
          <span style={{ color: "var(--text-mid)", marginLeft: 6 }}>./admin_panel.sh</span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: 0.5 }}>Kelola garapan</h1>
      </div>

      {/* form */}
      <div style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderTop: `2px solid ${isEditing ? "var(--live)" : "var(--indigo)"}`,
        borderRadius: 6,
        padding: "20px 24px",
        marginBottom: 32,
      }}>
        <div style={{ fontSize: 11, color: isEditing ? "var(--live)" : "var(--indigo-dim)", marginBottom: 16, letterSpacing: 1 }}>
          {isEditing ? "// EDIT MODE" : "// NEW ENTRY"}
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={labelStyle}>JUDUL</label>
              <input style={inputStyle} value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="nama project / raffle" required
                onFocus={e => e.target.style.borderColor = "var(--indigo)"}
                onBlur={e => e.target.style.borderColor = "var(--border)"}
              />
            </div>
            <div>
              <label style={labelStyle}>KATEGORI</label>
              <select style={inputStyle} value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                onFocus={e => e.target.style.borderColor = "var(--indigo)"}
                onBlur={e => e.target.style.borderColor = "var(--border)"}
              >
                <option value="NFT">NFT</option>
                <option value="RAFFLE">RAFFLE</option>
                <option value="CRYPTO">CRYPTO</option>
                <option value="MINT">MINT</option>
              </select>
            </div>
          </div>

          {form.category === "RAFFLE" && (
            <div>
              <label style={labelStyle}>STATUS RAFFLE</label>
              <select style={inputStyle} value={form.status}
                onChange={e => setForm({ ...form, status: e.target.value })}
                onFocus={e => e.target.style.borderColor = "var(--indigo)"}
                onBlur={e => e.target.style.borderColor = "var(--border)"}
              >
                <option value="LIVE">LIVE</option>
                <option value="PAST">PAST</option>
              </select>
            </div>
          )}

          {form.category === "MINT" && (
            <div>
              <label style={labelStyle}>SECONDARY LINK — TWITTER/X (opsional)</label>
              <input style={inputStyle} value={form.secondary_link}
                onChange={e => setForm({ ...form, secondary_link: e.target.value })}
                placeholder="https://x.com/..."
                onFocus={e => e.target.style.borderColor = "var(--indigo)"}
                onBlur={e => e.target.style.borderColor = "var(--border)"}
              />
            </div>
          )}

          <div>
            <label style={labelStyle}>DESKRIPSI</label>
            <textarea style={{ ...inputStyle, minHeight: 72, resize: "vertical" }}
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="ringkasan singkat garapan ini"
              onFocus={e => e.target.style.borderColor = "var(--indigo)"}
              onBlur={e => e.target.style.borderColor = "var(--border)"}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label style={labelStyle}>LINK</label>
              <input style={inputStyle} value={form.link}
                onChange={e => setForm({ ...form, link: e.target.value })}
                placeholder="https://..."
                onFocus={e => e.target.style.borderColor = "var(--indigo)"}
                onBlur={e => e.target.style.borderColor = "var(--border)"}
              />
            </div>
            <div>
              <label style={labelStyle}>IMAGE URL (opsional)</label>
              <input style={inputStyle} value={form.image_url}
                onChange={e => setForm({ ...form, image_url: e.target.value })}
                placeholder="https://..."
                onFocus={e => e.target.style.borderColor = "var(--indigo)"}
                onBlur={e => e.target.style.borderColor = "var(--border)"}
              />
            </div>
          </div>

          {errorMsg && (
            <div style={{ fontSize: 12, color: "#f87171", letterSpacing: 0.5 }}>
              ✗ {errorMsg}
            </div>
          )}

          <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
            <button type="submit" disabled={saving} style={{
              background: isEditing ? "var(--live)" : "var(--indigo)",
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "9px 20px",
              fontSize: 12, fontWeight: 700, letterSpacing: 1,
              opacity: saving ? 0.6 : 1,
            }}>
              {saving ? "SAVING..." : isEditing ? "UPDATE" : "+ ADD"}
            </button>
            {isEditing && (
              <button type="button" onClick={resetForm} style={{
                background: "transparent",
                color: "var(--text-dim)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "9px 20px",
                fontSize: 12, letterSpacing: 1,
              }}>
                CANCEL
              </button>
            )}
          </div>
        </form>
      </div>

      {/* entry list */}
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 14, letterSpacing: 1 }}>
        {entries.length} ENTRIES RECORDED
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {entries.map(entry => (
          <div key={entry.id} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            padding: "12px 16px",
            transition: "border-color 0.15s",
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "var(--border-hi)"}
            onMouseLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                <span style={{ color: "var(--indigo-dim)", marginRight: 6 }}>&gt;</span>
                {entry.title}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3, letterSpacing: 0.5 }}>
                [{entry.category}]
                {entry.status ? ` · ${getEffectiveStatus(entry)}` : ""}
                {" · "}
                <span style={{ color: "var(--indigo-dim)" }}>@</span>{entry.created_by}
              </div>
            </div>
            <div style={{ display: "flex", gap: 7, flexShrink: 0 }}>
              <button onClick={() => startEdit(entry)} style={{
                background: "transparent",
                border: "1px solid var(--border-hi)",
                borderRadius: 4, padding: "5px 12px",
                fontSize: 11, color: "var(--text-mid)", letterSpacing: 1,
              }}>
                EDIT
              </button>
              <button onClick={() => handleDelete(entry.id)} style={{
                background: "transparent",
                border: "1px solid #7f1d1d",
                borderRadius: 4, padding: "5px 12px",
                fontSize: 11, color: "#f87171", letterSpacing: 1,
              }}>
                DEL
              </button>
            </div>
          </div>
        ))}
      </div>
      </TerminalWindow>
    </main>
  );
}
