"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* --------------------------------------------------------------- gaya dasar */

const input = {
  width: "100%",
  background: "var(--bg2)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "8px 10px",
  fontSize: 12.5,
  color: "var(--text)",
  fontFamily: "var(--font-mono)",
  outline: "none",
};

const label = {
  display: "block",
  fontSize: 10,
  letterSpacing: 1,
  color: "var(--text-dim)",
  marginBottom: 5,
};

const panel = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: 16,
};

function btn(kind = "primary", disabled = false) {
  const base = {
    borderRadius: 4,
    padding: "8px 13px",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.8,
    fontFamily: "var(--font-mono)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    border: "1px solid transparent",
  };
  if (kind === "primary") {
    return { ...base, background: "var(--indigo)", color: "#fff" };
  }
  if (kind === "danger") {
    return { ...base, background: "transparent", borderColor: "#7f1d1d", color: "#f87171" };
  }
  return { ...base, background: "transparent", borderColor: "var(--border)", color: "var(--text-mid)" };
}

const STATUS_COLOR = {
  QUEUED: "var(--text-dim)",
  CLAIMED: "var(--live)",
  RUNNING: "var(--live)",
  DONE: "var(--crypto)",
  FAILED: "#f87171",
  CANCELLED: "var(--text-dim)",
};

const LEVEL_COLOR = {
  INFO: "var(--text-mid)",
  OK: "var(--crypto)",
  WARN: "var(--live)",
  ERROR: "#f87171",
};

function short(addr) {
  const s = String(addr || "");
  return s.length < 12 ? s : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("id-ID", {
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function countdown(iso) {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(diff)) return null;
  if (diff <= 0) return "sudah buka";

  const s = Math.floor(diff / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (d > 0) return `${d}h ${h}j lagi`;
  if (h > 0) return `${h}j ${m}m lagi`;
  if (m > 0) return `${m}m ${sec}s lagi`;
  return `${sec}s lagi`;
}

/* ======================================================== WALLET MANAGER */

function WalletManager({ wallets, onChange }) {
  const [privateKey, setPrivateKey] = useState("");
  const [walletLabel, setWalletLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);

  async function importWallet(e) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/aco/wallets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ private_key: privateKey, label: walletLabel || null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Gagal import wallet.");
        return;
      }
      // Kosongkan segera setelah sukses supaya private key tidak menetap di
      // state React lebih lama dari yang perlu.
      setPrivateKey("");
      setWalletLabel("");
      setShowForm(false);
      onChange();
    } catch {
      setError("Tidak bisa menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function removeWallet(id, address) {
    if (!confirm(`Hapus wallet ${short(address)}?\n\nPrivate key-nya akan dihapus dari database.`)) {
      return;
    }
    await fetch(`/api/aco/wallets/${id}`, { method: "DELETE" });
    onChange();
  }

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.8, color: "var(--text)" }}>
          WALLETS <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>({wallets.length})</span>
        </h2>
        <button onClick={() => setShowForm((v) => !v)} style={btn("ghost")}>
          {showForm ? "tutup" : "+ import"}
        </button>
      </div>

      {showForm && (
        <>
          {/* Peringatan ditaruh DI ATAS form, bukan di bawah — supaya dibaca
              sebelum orang menempel private key, bukan sesudah. */}
          <div
            style={{
              border: "1px solid #7f1d1d",
              background: "rgba(248,113,113,0.06)",
              borderRadius: 4,
              padding: "10px 12px",
              marginBottom: 14,
              fontSize: 11,
              lineHeight: 1.75,
              color: "var(--text-mid)",
            }}
          >
            <div style={{ color: "#f87171", fontWeight: 700, marginBottom: 5 }}>
              BACA DULU — INI SOAL UANG KAMU
            </div>
            Private key = kepemilikan penuh atas wallet. Yang disimpan di sini
            dienkripsi (AES-256-GCM) dan tidak pernah dikirim balik ke browser,
            tapi <strong style={{ color: "var(--text)" }}>admin server secara
            teknis tetap bisa mengaksesnya</strong>. Tidak ada teknologi yang
            bisa menghilangkan fakta itu.
            <div style={{ marginTop: 7, color: "var(--live)" }}>
              Pakai wallet burner khusus mint. Isi ETH secukupnya untuk gas +
              harga mint. Jangan pakai wallet utama kamu.
            </div>
          </div>

          <form onSubmit={importWallet} style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            <div>
              <label style={label}>PRIVATE KEY</label>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="0x… (64 karakter hex)"
                style={input}
              />
            </div>
            <div>
              <label style={label}>LABEL (opsional)</label>
              <input
                type="text"
                value={walletLabel}
                onChange={(e) => setWalletLabel(e.target.value)}
                placeholder="misal: burner-1"
                style={input}
              />
            </div>

            {error && (
              <div style={{ fontSize: 11, color: "#f87171" }}>{error}</div>
            )}

            <button type="submit" disabled={busy || !privateKey} style={btn("primary", busy || !privateKey)}>
              {busy ? "MENYIMPAN…" : "IMPORT WALLET"}
            </button>
          </form>
        </>
      )}

      {wallets.length === 0 ? (
        <p style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.7 }}>
          Belum ada wallet. Import dulu sebelum bisa bikin job mint.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {wallets.map((w) => (
            <div
              key={w.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--bg2)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "7px 10px",
                fontSize: 11.5,
              }}
            >
              <span style={{ color: "var(--indigo-dim)" }}>{short(w.address)}</span>
              {w.label && <span style={{ color: "var(--text-dim)" }}>{w.label}</span>}
              <button
                onClick={() => removeWallet(w.id, w.address)}
                title="hapus wallet"
                style={{
                  marginLeft: "auto",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                  fontSize: 13,
                  padding: "0 4px",
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* =========================================================== JOB CREATOR */

function JobCreator({ wallets, onCreated }) {
  const [slug, setSlug] = useState("");
  const [drop, setDrop] = useState(null);
  const [stageIdx, setStageIdx] = useState(null);
  const [amount, setAmount] = useState(1);
  const [gasLimit, setGasLimit] = useState(300000);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  async function loadDrop(e) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setDrop(null);
    setStageIdx(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/aco/drop?slug=${encodeURIComponent(slug.trim())}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Gagal ambil info drop.");
        return;
      }
      setDrop(json.data);
      if (!json.data.stages?.length) {
        setError("Collection ini tidak punya mint stage.");
      }
    } catch {
      setError("Tidak bisa menghubungi server.");
    } finally {
      setLoading(false);
    }
  }

  const stage = stageIdx != null ? drop?.stages?.[stageIdx] : null;
  const maxPerWallet = stage?.maxTotalMintableByWallet || 1;

  function toggleWallet(id) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function createJob() {
    if (creating || !stage) return;
    setError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/aco/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: drop.slug,
          contract_address: drop.contractAddress,
          chain: drop.chain,
          stage: {
            stageIndex: stage.stageIndex,
            label: stage.label,
            stageType: stage.stageType,
            startTime: stage.startTime,
            endTime: stage.endTime,
            priceUnit: stage.priceUnit,
          },
          mint_amount: Math.min(amount, maxPerWallet),
          gas_limit: gasLimit,
          wallet_ids: selected,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Gagal bikin job.");
        return;
      }
      setSlug("");
      setDrop(null);
      setStageIdx(null);
      setSelected([]);
      onCreated();
    } catch {
      setError("Tidak bisa menghubungi server.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={panel}>
      <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.8, color: "var(--text)", marginBottom: 12 }}>
        JOB BARU
      </h2>

      <form onSubmit={loadDrop} style={{ display: "flex", gap: 7, marginBottom: 14 }}>
        <input
          type="text"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="collection slug (dari url opensea)"
          style={{ ...input, flex: 1 }}
        />
        <button type="submit" disabled={loading || !slug.trim()} style={btn("ghost", loading || !slug.trim())}>
          {loading ? "…" : "CEK"}
        </button>
      </form>

      {error && (
        <div style={{ fontSize: 11, color: "#f87171", marginBottom: 12, lineHeight: 1.6 }}>{error}</div>
      )}

      {drop && drop.stages?.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 10, lineHeight: 1.8 }}>
            <div><span style={{ color: "var(--text-mid)" }}>{drop.name}</span></div>
            <div>contract: {short(drop.contractAddress)} · chain: {drop.chain}</div>
          </div>

          <label style={label}>PILIH STAGE</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 14 }}>
            {drop.stages.map((s, i) => {
              const now = Date.now();
              const ended = new Date(s.endTime).getTime() <= now;
              const live = new Date(s.startTime).getTime() <= now && !ended;
              const active = stageIdx === i;

              return (
                <button
                  key={i}
                  type="button"
                  disabled={ended}
                  onClick={() => { setStageIdx(i); setAmount(1); }}
                  style={{
                    textAlign: "left",
                    background: active ? "var(--indigo-glow)" : "var(--bg2)",
                    border: `1px solid ${active ? "var(--indigo)" : "var(--border)"}`,
                    borderRadius: 4,
                    padding: "8px 11px",
                    cursor: ended ? "not-allowed" : "pointer",
                    opacity: ended ? 0.4 : 1,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5 }}>
                    <span style={{ color: ended ? "var(--text-dim)" : live ? "var(--live)" : "var(--crypto)" }}>
                      {ended ? "ENDED" : live ? "● LIVE" : "SOON"}
                    </span>
                    <span style={{ color: "var(--text)" }}>{s.label}</span>
                    <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{s.stageType}</span>
                    <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>
                      max {s.maxTotalMintableByWallet}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 3 }}>
                    {fmtTime(s.startTime)} · {s.priceUnit} {s.priceSymbol}
                    {!ended && !live && (
                      <span style={{ color: "var(--live)" }}> · {countdown(s.startTime)}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {stage && (
            <>
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <div style={{ flex: 1 }}>
                  <label style={label}>AMOUNT / WALLET (max {maxPerWallet})</label>
                  <input
                    type="number"
                    min={1}
                    max={maxPerWallet}
                    value={amount}
                    onChange={(e) => setAmount(Math.max(1, Math.min(parseInt(e.target.value) || 1, maxPerWallet)))}
                    style={input}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={label}>GAS LIMIT</label>
                  <input
                    type="number"
                    min={21000}
                    step={10000}
                    value={gasLimit}
                    onChange={(e) => setGasLimit(parseInt(e.target.value) || 300000)}
                    style={input}
                  />
                </div>
              </div>

              <label style={label}>WALLET YANG DIPAKAI ({selected.length} dipilih)</label>
              {wallets.length === 0 ? (
                <p style={{ fontSize: 11, color: "var(--live)", marginBottom: 12 }}>
                  Import wallet dulu di panel sebelah.
                </p>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 14 }}>
                  {wallets.map((w) => {
                    const on = selected.includes(w.id);
                    return (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => toggleWallet(w.id)}
                        style={{
                          fontSize: 10.5,
                          background: on ? "var(--indigo)" : "transparent",
                          color: on ? "#fff" : "var(--text-dim)",
                          border: `1px solid ${on ? "var(--indigo)" : "var(--border)"}`,
                          borderRadius: 3,
                          padding: "4px 8px",
                          cursor: "pointer",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {w.label || short(w.address)}
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                onClick={createJob}
                disabled={creating || selected.length === 0}
                style={{ ...btn("primary", creating || selected.length === 0), width: "100%" }}
              >
                {creating ? "MEMBUAT JOB…" : `JADWALKAN MINT — ${selected.length} wallet × ${amount}`}
              </button>

              <p style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 9, lineHeight: 1.7 }}>
                Job masuk antrean, worker di VPS yang mengeksekusi. Kamu tidak
                perlu membuka halaman ini terus — mint jalan walau browser ditutup.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ============================================================= JOB DETAIL */

function JobDetail({ jobId, onClose, onChanged }) {
  const [job, setJob] = useState(null);
  const [logs, setLogs] = useState([]);
  const lastLogId = useRef(0);
  const logBox = useRef(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/aco/jobs/${jobId}?after=${lastLogId.current}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = await res.json();
      if (!json.data) return;

      setJob(json.data.job);
      if (json.data.logs.length > 0) {
        setLogs((prev) => [...prev, ...json.data.logs]);
        lastLogId.current = json.data.logs[json.data.logs.length - 1].id;
      }
    } catch {
      // diam, coba lagi siklus berikutnya
    }
  }, [jobId]);

  useEffect(() => {
    poll();
    // Job aktif dipoll cepat (2s) supaya progres mint kelihatan hidup; kalau
    // sudah selesai, interval dihentikan biar tidak buang request.
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => {
    if (job && ["DONE", "FAILED", "CANCELLED"].includes(job.status)) {
      onChanged();
    }
  }, [job?.status]);

  // Auto-scroll ke log terbaru
  useEffect(() => {
    if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [logs.length]);

  if (!job) {
    return <div style={{ ...panel, fontSize: 11.5, color: "var(--text-dim)" }}>memuat…</div>;
  }

  const canCancel = ["QUEUED", "CLAIMED"].includes(job.status);

  async function cancel() {
    if (!confirm("Batalkan job ini?")) return;
    await fetch(`/api/aco/jobs/${job.id}`, { method: "DELETE" });
    poll();
    onChanged();
  }

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ color: STATUS_COLOR[job.status], fontSize: 11.5, fontWeight: 700 }}>
          {job.status}
        </span>
        <span style={{ fontSize: 12.5, color: "var(--text)" }}>{job.slug}</span>
        {job.stage_label && (
          <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{job.stage_label}</span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {canCancel && <button onClick={cancel} style={btn("danger")}>BATALKAN</button>}
          <button onClick={onClose} style={btn("ghost")}>tutup</button>
        </div>
      </div>

      <div style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.9, marginBottom: 12 }}>
        <div>wallet: {job.wallet_ids?.length || 0} · amount: {job.mint_amount} · gas: {job.gas_limit}</div>
        <div>stage mulai: {fmtTime(job.stage_start_time)}
          {job.status === "QUEUED" && countdown(job.stage_start_time) && (
            <span style={{ color: "var(--live)" }}> · {countdown(job.stage_start_time)}</span>
          )}
        </div>
        {job.error_message && (
          <div style={{ color: "#f87171", marginTop: 4 }}>{job.error_message}</div>
        )}
      </div>

      {Array.isArray(job.result_summary) && job.result_summary.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label style={label}>HASIL</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {job.result_summary.map((r, i) => (
              <div key={i} style={{ fontSize: 10.5, display: "flex", gap: 7, alignItems: "baseline" }}>
                <span style={{ color: r.success ? "var(--crypto)" : "#f87171" }}>
                  {r.success ? "OK " : "GAGAL"}
                </span>
                <span style={{ color: "var(--indigo-dim)" }}>{short(r.address)}</span>
                {r.txHash ? (
                  <a
                    href={`https://etherscan.io/tx/${r.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--text-mid)", textDecoration: "underline" }}
                  >
                    {short(r.txHash)}
                  </a>
                ) : (
                  <span style={{ color: "var(--text-dim)" }}>{r.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <label style={label}>LOG</label>
      <div
        ref={logBox}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: 10,
          maxHeight: 340,
          overflowY: "auto",
          fontSize: 10.5,
          lineHeight: 1.75,
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: "var(--text-dim)" }}>
            {job.status === "QUEUED"
              ? "menunggu worker mengambil job…"
              : "belum ada log."}
          </div>
        ) : (
          logs.map((l) => (
            <div key={l.id} style={{ display: "flex", gap: 7 }}>
              <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>
                {new Date(l.created_at).toLocaleTimeString("id-ID")}
              </span>
              <span style={{ color: LEVEL_COLOR[l.level] || "var(--text-mid)", flexShrink: 0, width: 42 }}>
                {l.level}
              </span>
              <span style={{ color: "var(--text-mid)", wordBreak: "break-word" }}>
                {l.wallet_address && (
                  <span style={{ color: "var(--indigo-dim)" }}>[{short(l.wallet_address)}] </span>
                )}
                {l.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ============================================================== DASHBOARD */

export default function AcoDashboard() {
  const [wallets, setWallets] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [openJob, setOpenJob] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const loadWallets = useCallback(async () => {
    const res = await fetch("/api/aco/wallets", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      setWallets(json.data || []);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/aco/jobs", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      setJobs(json.data || []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    loadWallets();
    loadJobs();
  }, [loadWallets, loadJobs]);

  // Refresh daftar job berkala supaya status berubah sendiri saat worker
  // memproses. Detail job punya polling sendiri yang lebih cepat.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) loadJobs();
    }, 8000);
    return () => clearInterval(t);
  }, [loadJobs]);

  const activeCount = jobs.filter((j) => ["QUEUED", "CLAIMED", "RUNNING"].includes(j.status)).length;

  return (
    <main style={{ maxWidth: 1400, margin: "0 auto", padding: "22px 20px 60px" }}>
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1, color: "var(--text)" }}>
            <span style={{ color: "var(--indigo-dim)" }}>~/</span>aco
          </h1>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            auto checkout opensea · {wallets.length} wallet · {activeCount} job aktif
          </span>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.7 }}>
          Jadwalkan mint, worker di VPS yang eksekusi. Browser boleh ditutup.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 340px) 1fr",
          gap: 14,
          alignItems: "start",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <WalletManager wallets={wallets} onChange={loadWallets} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {openJob ? (
            <JobDetail
              jobId={openJob}
              onClose={() => setOpenJob(null)}
              onChanged={loadJobs}
            />
          ) : (
            <JobCreator
              wallets={wallets}
              onCreated={() => { loadJobs(); }}
            />
          )}

          <div style={panel}>
            <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.8, color: "var(--text)", marginBottom: 12 }}>
              RIWAYAT JOB
            </h2>

            {!loaded ? (
              <p style={{ fontSize: 11.5, color: "var(--text-dim)" }}>memuat…</p>
            ) : jobs.length === 0 ? (
              <p style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.7 }}>
                Belum ada job. Bikin di atas.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {jobs.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => setOpenJob(j.id)}
                    style={{
                      textAlign: "left",
                      background: openJob === j.id ? "var(--indigo-glow)" : "var(--bg2)",
                      border: "1px solid var(--border)",
                      borderLeft: `2px solid ${STATUS_COLOR[j.status]}`,
                      borderRadius: 4,
                      padding: "8px 11px",
                      cursor: "pointer",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, flexWrap: "wrap" }}>
                      <span style={{ color: STATUS_COLOR[j.status], fontWeight: 700, minWidth: 62 }}>
                        {j.status}
                      </span>
                      <span style={{ color: "var(--text)" }}>{j.slug}</span>
                      {j.stage_label && (
                        <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{j.stage_label}</span>
                      )}
                      <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>
                        {j.wallet_ids?.length || 0}w × {j.mint_amount}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 3 }}>
                      {fmtTime(j.created_at)}
                      {j.status === "QUEUED" && countdown(j.stage_start_time) && (
                        <span style={{ color: "var(--live)" }}> · mint {countdown(j.stage_start_time)}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
