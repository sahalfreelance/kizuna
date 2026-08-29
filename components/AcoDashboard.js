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

/* ==================================================== OPENSEA KEY PANEL */

function OpenseaKeyPanel() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/aco/user-key", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      setStatus(json.data);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      // Dijalankan dari BROWSER supaya kuota 2/hari terpakai dari IP user ini,
      // bukan IP server yang dibagi semua user.
      const { forceRefreshUserKey } = await import("@/lib/openseaKeyClient");
      const result = await forceRefreshUserKey();
      setMsg(result);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const ok = status?.present && !status?.expired;

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.8, color: "var(--text)" }}>
          OPENSEA KEY
        </h2>
        <button onClick={refresh} disabled={busy} style={btn("ghost", busy)}>
          {busy ? "…" : "refresh"}
        </button>
      </div>

      {status === null ? (
        <p style={{ fontSize: 11, color: "var(--text-dim)" }}>memuat…</p>
      ) : !status.present ? (
        <p style={{ fontSize: 11, color: "var(--live)", lineHeight: 1.7 }}>
          Belum ada API key. Tekan <strong>refresh</strong> untuk membuatnya —
          key diminta dari browser kamu, jadi tidak berebut kuota dengan user lain.
        </p>
      ) : (
        <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.9 }}>
          <div>
            <span style={{ color: ok ? "var(--crypto)" : "#f87171" }}>
              {ok ? "● aktif" : "✗ kedaluwarsa"}
            </span>{" "}
            <span style={{ color: "var(--text-mid)" }}>…{status.hint}</span>
          </div>
          <div>umur {status.ageDays} hari
            {status.daysLeft != null && ` · sisa ${status.daysLeft} hari`}
          </div>
          {status.needsRefresh && !status.expired && (
            <div style={{ color: "var(--live)" }}>
              sudah waktunya diperbarui ({status.reason})
            </div>
          )}
        </div>
      )}

      {msg && (
        <div
          style={{
            marginTop: 9,
            fontSize: 10.5,
            lineHeight: 1.7,
            color:
              msg.action === "rate_limited"
                ? "var(--live)"
                : msg.action === "failed"
                ? "#f87171"
                : "var(--crypto)",
          }}
        >
          {msg.action === "rate_limited"
            ? "Kuota pembuatan key OpenSea habis (2 per hari dari IP kamu). Coba lagi besok — key lama tetap dipakai kalau masih berlaku."
            : msg.reason}
        </div>
      )}

      <p style={{ fontSize: 9.5, color: "var(--text-dim)", lineHeight: 1.65, marginTop: 10, paddingTop: 9, borderTop: "1px solid var(--border)" }}>
        Tiap user punya API key sendiri supaya rate limit tidak bentrok saat
        beberapa orang mint bersamaan. Key diperiksa otomatis tiap kamu login
        dan diperbarui kalau sudah tua. Berlaku 30 hari.
      </p>
    </div>
  );
}

/* ======================================================== RPC MANAGER */

function RpcManager({ chains, onChange }) {
  const [openChain, setOpenChain] = useState(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    if (busy || !openChain) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/aco/rpcs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain: openChain, rpc_url: url }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Gagal simpan RPC.");
        return;
      }
      setUrl("");
      setOpenChain(null);
      onChange();
    } catch {
      setError("Tidak bisa menghubungi server.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(chain) {
    if (!confirm(`Hapus RPC custom untuk ${chain}?\n\nChain ini akan kembali pakai RPC publik.`)) {
      return;
    }
    await fetch(`/api/aco/rpcs?chain=${encodeURIComponent(chain)}`, { method: "DELETE" });
    onChange();
  }

  const withCustom = chains.filter((c) => c.hasCustomRpc).length;

  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.8, color: "var(--text)" }}>
          RPC{" "}
          <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>
            ({withCustom}/{chains.length} custom)
          </span>
        </h2>
      </div>

      <p style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.7, marginBottom: 12 }}>
        Chain tanpa RPC custom pakai RPC publik gratis — rate-limit ketat, bisa
        kalah cepat saat mint rame. Isi RPC sendiri (Alchemy/Infura/QuickNode)
        untuk chain yang sering kamu pakai.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {chains.map((c) => (
          <div key={c.identifier}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "var(--bg2)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "6px 10px",
                fontSize: 11,
              }}
            >
              <span style={{ color: "var(--text)", minWidth: 88 }}>{c.label}</span>
              <span style={{ color: "var(--text-dim)", fontSize: 9.5 }}>{c.chainId}</span>

              {c.hasCustomRpc ? (
                <span style={{ color: "var(--crypto)", fontSize: 10, marginLeft: 4 }}>
                  {c.customHost}
                </span>
              ) : (
                <span style={{ color: "var(--text-dim)", fontSize: 10, marginLeft: 4 }}>
                  publik
                </span>
              )}

              <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                <button
                  onClick={() => {
                    setOpenChain(openChain === c.identifier ? null : c.identifier);
                    setUrl("");
                    setError(null);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "var(--indigo-dim)",
                    cursor: "pointer",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {c.hasCustomRpc ? "ganti" : "set"}
                </button>
                {c.hasCustomRpc && (
                  <button
                    onClick={() => remove(c.identifier)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--text-dim)",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {openChain === c.identifier && (
              <form onSubmit={save} style={{ marginTop: 5, marginBottom: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder={`https://... atau wss://... (${c.label})`}
                  style={{ ...input, fontSize: 11 }}
                />
                {error && <div style={{ fontSize: 10.5, color: "#f87171" }}>{error}</div>}
                <div style={{ display: "flex", gap: 5 }}>
                  <button type="submit" disabled={busy || !url} style={btn("primary", busy || !url)}>
                    {busy ? "…" : "SIMPAN"}
                  </button>
                  <button type="button" onClick={() => setOpenChain(null)} style={btn("ghost")}>
                    batal
                  </button>
                </div>
                <p style={{ fontSize: 9.5, color: "var(--text-dim)", lineHeight: 1.6 }}>
                  RPC disimpan terenkripsi dan tidak pernah ditampilkan lagi —
                  yang muncul cuma nama host-nya. Worker memverifikasi chain id
                  RPC sebelum mint; kalau tidak cocok, job digagalkan.
                </p>
              </form>
            )}
          </div>
        ))}
      </div>
    </div>
  );
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

function WalletManager({ wallets, limit, onChange }) {
  const [privateKey, setPrivateKey] = useState("");
  const [walletLabel, setWalletLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);

  const maxWallets = limit ?? 2;
  const full = wallets.length >= maxWallets;

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
          WALLETS{" "}
          <span style={{ color: full ? "var(--live)" : "var(--text-dim)", fontWeight: 400 }}>
            ({wallets.length}/{maxWallets})
          </span>
        </h2>
        {/* Tombol import disembunyikan kalau kuota penuh — kalau ditampilkan
            lalu ditolak server, user cuma kebingungan. */}
        {!full && (
          <button onClick={() => setShowForm((v) => !v)} style={btn("ghost")}>
            {showForm ? "tutup" : "+ import"}
          </button>
        )}
      </div>

      {full && (
        <p style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.7, marginBottom: 10 }}>
          Kuota wallet penuh (maks {maxWallets}). Hapus salah satu dulu kalau mau ganti.
        </p>
      )}

      {showForm && !full && (
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

/* ================================================== ELIGIBILITY BADGE */

/**
 * Label eligibility di samping stage.
 *
 * Bentuknya:
 *   1 wallet  -> "ELIGIBLE" / "NOT ELIGIBLE"
 *   2 wallet  -> "ELIGIBLE 2/2" / "ELIGIBLE 1/2" / "NOT ELIGIBLE"
 *
 * `unknown` DIBEDAKAN dari `not eligible`. Kalau data tidak terbaca (error
 * jaringan, field ditolak), menampilkan "NOT ELIGIBLE" akan membuat user
 * membatalkan mint yang sebenarnya bisa — jadi ditandai "?" saja.
 */
function EligBadge({ summary, totalWallets, state }) {
  if (state === "checking") {
    return (
      <span style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: 0.5 }}>
        CEK…
      </span>
    );
  }

  if (!summary) return null;

  const { eligibleCount, notEligibleCount, unknownCount, checkedWallets } = summary;
  const multi = totalWallets > 1;

  // Semua wallet gagal dibaca.
  if (checkedWallets > 0 && unknownCount === checkedWallets) {
    return (
      <span
        style={{
          fontSize: 9,
          letterSpacing: 0.5,
          color: "var(--text-dim)",
          border: "1px solid var(--border)",
          borderRadius: 3,
          padding: "1px 5px",
        }}
      >
        ? TIDAK DIKETAHUI
      </span>
    );
  }

  const eligible = eligibleCount > 0;
  const color = eligible ? "var(--crypto)" : "#f87171";

  return (
    <span
      style={{
        fontSize: 9,
        letterSpacing: 0.5,
        fontWeight: 700,
        color,
        border: `1px solid ${color}`,
        borderRadius: 3,
        padding: "1px 5px",
        whiteSpace: "nowrap",
      }}
    >
      {eligible
        ? multi
          ? `ELIGIBLE ${eligibleCount}/${totalWallets}`
          : "ELIGIBLE"
        : "NOT ELIGIBLE"}
    </span>
  );
}

/**
 * Rincian per wallet di bawah baris stage.
 *
 * `ELIGIBLE 1/2` tanpa keterangan memaksa user menebak wallet mana yang lolos,
 * jadi daftarnya ditampilkan. Hanya muncul kalau wallet lebih dari satu.
 */
function EligWalletDetail({ elig, stageIndex }) {
  if (!elig?.wallets?.length || elig.wallets.length < 2) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
      {elig.wallets.map((w) => {
        const st = w.stages?.find((s) => s.stageIndex === stageIndex);
        const val = st?.eligible;
        const color =
          val === true ? "var(--crypto)" : val === false ? "#f87171" : "var(--text-dim)";
        const mark = val === true ? "✓" : val === false ? "✗" : "?";

        return (
          <span key={w.walletId} style={{ fontSize: 9, color }}>
            {mark} {w.label}
            {val === true && st?.maxMintable ? ` (max ${st.maxMintable})` : ""}
          </span>
        );
      })}
    </div>
  );
}

/* =========================================================== JOB CREATOR */

function JobCreator({ wallets, chains, platform, onCreated }) {
  const [slug, setSlug] = useState("");
  const [drop, setDrop] = useState(null);
  const [stageIdx, setStageIdx] = useState(null);
  const [amount, setAmount] = useState(1);
  const [gasLimit, setGasLimit] = useState(300000);
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  // Pengaman: default anti-revert ON, 3 percobaan. Keduanya bisa diubah user
  // per job.
  const [abortOnRevert, setAbortOnRevert] = useState(true);
  const [maxAttempts, setMaxAttempts] = useState(3);

  // Hasil eligibility check dari worker. `eligState`:
  //   idle | checking | done | error | timeout
  const [elig, setElig] = useState(null);
  const [eligState, setEligState] = useState("idle");
  const [eligError, setEligError] = useState(null);

  // Chain ditampilkan sebagai Ethereum secara default, lalu DIGANTI otomatis
  // dengan chain asli hasil deteksi saat slug dicek. User tidak memilih sendiri
  // — kalau bisa dipilih, ada peluang salah pasang dan transaksi dikirim ke
  // jaringan yang salah.
  const detected = drop
    ? {
        identifier: drop.chain,
        label: drop.chainLabel || drop.chain,
        chainId: drop.chainId,
        supported: drop.chainSupported,
      }
    : { identifier: "ethereum", label: "Ethereum", chainId: 1, supported: true };

  const chainRpc = chains.find((c) => c.identifier === detected.identifier);

  async function loadDrop(e) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setDrop(null);
    setStageIdx(null);
    setElig(null);
    setEligState("idle");
    setEligError(null);
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
        return;
      }
      // Eligibility check dijalankan BERSAMAAN dengan cek slug, tidak menunggu
      // klik terpisah. Tidak di-await supaya info drop langsung tampil —
      // checker butuh SIWE login (~2-4 detik) di worker VPS.
      startEligibilityCheck(json.data.slug);
    } catch {
      setError("Tidak bisa menghubungi server.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Titipkan pengecekan ke worker, lalu polling hasilnya.
   *
   * Kenapa lewat worker: field eligibility di OpenSea dikunci di balik auth,
   * dan SIWE login butuh private key wallet yang hanya didekripsi di VPS.
   */
  async function startEligibilityCheck(checkSlug) {
    setEligState("checking");
    setEligError(null);
    setElig(null);

    try {
      const res = await fetch("/api/aco/eligibility", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: checkSlug }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setEligState("error");
        setEligError(json.error || "Gagal mulai pengecekan.");
        return;
      }

      const checkId = json.data.id;

      // Polling cepat (400ms) selama ~30 detik. Worker biasanya selesai dalam
      // 1-3 detik kalau session sudah hangat. Interval 1 detik membuat hasil
      // yang siap dalam 1,2s terasa 2s — untuk alat yang tujuannya cepat, itu
      // sia-sia.
      for (let i = 0; i < 75; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 250 : 400));

        const pRes = await fetch(`/api/aco/eligibility?id=${checkId}`, {
          cache: "no-store",
        });
        if (!pRes.ok) continue;

        const pJson = await pRes.json().catch(() => ({}));
        const row = pJson.data;
        if (!row) continue;

        if (row.status === "DONE") {
          setElig(row.result);
          setEligState("done");
          return;
        }
        if (row.status === "FAILED") {
          setEligState("error");
          setEligError(row.error_message || "Pengecekan gagal.");
          return;
        }
      }

      setEligState("timeout");
      setEligError(
        "Worker belum merespons dalam 30 detik. Cek worker di VPS jalan atau tidak " +
          "(pm2 logs kizuna-aco-worker)."
      );
    } catch {
      setEligState("error");
      setEligError("Tidak bisa menghubungi server.");
    }
  }

  const stage = stageIdx != null ? drop?.stages?.[stageIdx] : null;
  const maxPerWallet = stage?.maxTotalMintableByWallet || 1;

  // Ringkasan eligibility per stageIndex, dipakai badge di tiap baris stage.
  const eligByStage = new Map(
    (elig?.stages ?? []).map((s) => [s.stageIndex, s])
  );

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
          platform,
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
          abort_on_revert: abortOnRevert,
          max_attempts: maxAttempts,
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

      <form onSubmit={loadDrop} style={{ display: "flex", gap: 7, marginBottom: 10 }}>
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

      {/* Chain: default Ethereum, diganti otomatis setelah slug dicek. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--bg2)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "6px 10px",
          fontSize: 10.5,
          marginBottom: 14,
        }}
      >
        <span style={{ color: "var(--text-dim)" }}>CHAIN</span>
        <span style={{ color: detected.supported ? "var(--crypto)" : "#f87171" }}>
          {detected.label}
        </span>
        {detected.chainId && (
          <span style={{ color: "var(--text-dim)", fontSize: 9.5 }}>id {detected.chainId}</span>
        )}
        <span style={{ color: "var(--text-dim)", fontSize: 9.5 }}>
          · RPC {chainRpc?.hasCustomRpc ? chainRpc.customHost : "publik"}
        </span>
        <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 9.5 }}>
          {drop ? "terdeteksi dari slug" : "default — cek slug dulu"}
        </span>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: "#f87171", marginBottom: 12, lineHeight: 1.6 }}>{error}</div>
      )}

      {drop && drop.stages?.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 10, lineHeight: 1.8 }}>
            <div><span style={{ color: "var(--text-mid)" }}>{drop.name}</span></div>
            <div>
              contract: {short(drop.contractAddress)} ·{" "}
              <span style={{ color: drop.chainSupported ? "var(--crypto)" : "#f87171" }}>
                {drop.chainLabel || drop.chain}
              </span>
              {drop.chainId ? ` (id ${drop.chainId})` : ""}
            </div>
          </div>

          {/* Chain diambil dari OpenSea, bukan dipilih user — jadi tidak
              mungkin salah pasang. Kalau chain-nya belum didukung, hentikan
              di sini daripada membiarkan job dibuat lalu gagal di worker. */}
          {!drop.chainSupported && (
            <div
              style={{
                border: "1px solid #7f1d1d",
                background: "rgba(248,113,113,0.06)",
                borderRadius: 4,
                padding: "9px 11px",
                fontSize: 11,
                lineHeight: 1.7,
                color: "var(--text-mid)",
                marginBottom: 12,
              }}
            >
              <span style={{ color: "#f87171", fontWeight: 700 }}>
                Chain "{drop.chain}" belum didukung.
              </span>{" "}
              Collection ini tidak bisa di-mint lewat ACO untuk sekarang.
            </div>
          )}
        </>
      )}

      {drop && drop.stages?.length > 0 && drop.chainSupported && (
        <>
          {/* Status pengecekan eligibility. Ditampilkan terpisah dari badge
              supaya kegagalan checker tidak menghalangi pembuatan job —
              checker itu bantuan, bukan syarat. */}
          {eligState !== "idle" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: "var(--bg2)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "6px 10px",
                fontSize: 10.5,
                marginBottom: 10,
              }}
            >
              <span style={{ color: "var(--text-dim)" }}>ELIGIBILITY</span>
              {eligState === "checking" && (
                <span style={{ color: "var(--live)" }}>
                  cek wallet di worker…
                </span>
              )}
              {eligState === "done" && (
                <>
                  <span style={{ color: "var(--crypto)" }}>
                    {elig?.totalWallets ?? 0} wallet dicek
                    {elig?.durationMs ? ` · ${(elig.durationMs / 1000).toFixed(1)}s` : ""}
                  </span>
                  {elig?.wallets?.some((w) => !w.ok) && (
                    <span style={{ color: "#f87171", fontSize: 10 }}>
                      · {elig.wallets.filter((w) => !w.ok).length} gagal:{" "}
                      {elig.wallets.find((w) => !w.ok)?.error?.slice(0, 70)}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => startEligibilityCheck(drop.slug)}
                    style={{
                      marginLeft: "auto",
                      background: "transparent",
                      border: "none",
                      color: "var(--indigo-dim)",
                      cursor: "pointer",
                      fontSize: 10,
                      fontFamily: "var(--font-mono)",
                      padding: 0,
                    }}
                  >
                    cek ulang
                  </button>
                </>
              )}
              {(eligState === "error" || eligState === "timeout") && (
                <>
                  <span style={{ color: "#f87171" }}>{eligError}</span>
                  <button
                    type="button"
                    onClick={() => startEligibilityCheck(drop.slug)}
                    style={{
                      marginLeft: "auto",
                      background: "transparent",
                      border: "none",
                      color: "var(--indigo-dim)",
                      cursor: "pointer",
                      fontSize: 10,
                      fontFamily: "var(--font-mono)",
                      padding: 0,
                    }}
                  >
                    coba lagi
                  </button>
                </>
              )}
            </div>
          )}

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
                  <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, flexWrap: "wrap" }}>
                    <span style={{ color: ended ? "var(--text-dim)" : live ? "var(--live)" : "var(--crypto)" }}>
                      {ended ? "ENDED" : live ? "● LIVE" : "SOON"}
                    </span>
                    <span style={{ color: "var(--text)" }}>{s.label}</span>
                    <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{s.stageType}</span>

                    {/* Label eligibility hasil pengecekan worker. */}
                    <EligBadge
                      summary={eligByStage.get(s.stageIndex)}
                      totalWallets={elig?.totalWallets ?? 0}
                      state={eligState}
                    />

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

                  {/* Rincian per wallet — muncul kalau lebih dari 1 wallet. */}
                  {eligState === "done" && (
                    <EligWalletDetail elig={elig} stageIndex={s.stageIndex} />
                  )}
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

              <label style={label}>
                WALLET YANG DIPAKAI ({selected.length}/{wallets.length} dipilih)
              </label>
              {wallets.length === 0 ? (
                <p style={{ fontSize: 11, color: "var(--live)", marginBottom: 12 }}>
                  Import wallet dulu di panel sebelah.
                </p>
              ) : (
                <>
                  {/* Wallet dipilih bebas: bisa satu, bisa dua, bisa keduanya
                      untuk mint bersamaan. Tombol pilih semua / kosongkan cuma
                      ditampilkan kalau ada lebih dari satu wallet. */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
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
                            padding: "5px 10px",
                            cursor: "pointer",
                            fontFamily: "var(--font-mono)",
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          <span style={{ fontSize: 9 }}>{on ? "◉" : "○"}</span>
                          {w.label || short(w.address)}
                        </button>
                      );
                    })}
                  </div>

                  {wallets.length > 1 && (
                    <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={() => setSelected(wallets.map((w) => w.id))}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--indigo-dim)",
                          cursor: "pointer",
                          fontSize: 10,
                          fontFamily: "var(--font-mono)",
                          padding: 0,
                        }}
                      >
                        pakai semua ({wallets.length})
                      </button>
                      <span style={{ color: "var(--border)" }}>|</span>
                      <button
                        type="button"
                        onClick={() => setSelected([])}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--text-dim)",
                          cursor: "pointer",
                          fontSize: 10,
                          fontFamily: "var(--font-mono)",
                          padding: 0,
                        }}
                      >
                        kosongkan
                      </button>
                      <span style={{ marginLeft: "auto", fontSize: 9.5, color: "var(--text-dim)" }}>
                        {selected.length === wallets.length
                          ? "mint bersamaan (paralel)"
                          : selected.length === 1
                          ? "mint 1 wallet"
                          : selected.length === 0
                          ? "belum ada yang dipilih"
                          : `mint ${selected.length} wallet`}
                      </span>
                    </div>
                  )}
                </>
              )}

              <label style={label}>PENGAMAN</label>
              <div
                style={{
                  background: "var(--bg2)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  padding: "9px 11px",
                  marginBottom: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <label style={{ display: "flex", alignItems: "flex-start", gap: 7, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={abortOnRevert}
                    onChange={(e) => setAbortOnRevert(e.target.checked)}
                    style={{ marginTop: 2, accentColor: "var(--indigo)" }}
                  />
                  <span style={{ fontSize: 10.5, lineHeight: 1.65, color: "var(--text-mid)" }}>
                    <strong style={{ color: "var(--text)" }}>Anti-revert</strong> — simulasi
                    tx dulu (eth_call). Kalau diperkirakan gagal, tx tidak dikirim
                    dan gas tidak terbuang.
                    <span style={{ color: "var(--text-dim)" }}>
                      {" "}Matikan hanya kalau kamu sengaja mau memaksa kirim.
                    </span>
                  </span>
                </label>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10.5, color: "var(--text-mid)" }}>
                    Auto-retry per wallet
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={maxAttempts}
                    onChange={(e) =>
                      setMaxAttempts(Math.max(1, Math.min(parseInt(e.target.value) || 3, 10)))
                    }
                    style={{ ...input, width: 62, padding: "4px 7px", fontSize: 11 }}
                  />
                  <span style={{ fontSize: 9.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
                    percobaan. Error sementara (RPC mati, rate limit, stage belum
                    buka) diulang otomatis; error final (tidak eligible, sold out,
                    saldo kurang) tidak.
                  </span>
                </div>
              </div>

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

/* ================================================== PLATFORM BELUM SIAP */

/**
 * Panel untuk platform yang belum aktif (Scatter, mint-by-contract).
 *
 * Sengaja TIDAK menampilkan form yang bisa diisi: form yang menerima input
 * lalu gagal di worker lebih buruk daripada penjelasan jujur bahwa fiturnya
 * belum ada.
 */
function PlatformComingSoon({ platform }) {
  return (
    <div style={panel}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.8, color: "var(--text)" }}>
          {platform.label.toUpperCase()}
        </h2>
        <span
          style={{
            fontSize: 9,
            letterSpacing: 0.8,
            color: "var(--live)",
            border: "1px solid var(--live)",
            borderRadius: 3,
            padding: "1px 6px",
          }}
        >
          BELUM AKTIF
        </span>
      </div>

      <p style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.8, marginBottom: 14 }}>
        {platform.description}
      </p>

      <div
        style={{
          background: "var(--bg2)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "11px 13px",
          fontSize: 10.5,
          lineHeight: 1.85,
          color: "var(--text-dim)",
        }}
      >
        <div style={{ color: "var(--text-mid)", marginBottom: 6 }}>
          Yang sudah siap dipakai bersama nanti:
        </div>
        <div>· Wallet terenkripsi — sama, tidak perlu import ulang</div>
        <div>· RPC per chain + fallback otomatis</div>
        <div>· Anti-revert (simulasi sebelum kirim)</div>
        <div>· Auto-retry dengan klasifikasi error</div>
        <div>· Anti rate-limit (token bucket per host)</div>

        {/* Deskripsi pekerjaan yang tersisa datang dari lib/platforms.js,
            bukan hardcode di sini — supaya menambah platform cuma perlu
            mengubah registry. */}
        {platform.pendingWork && (
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: "1px solid var(--border)",
              color: "var(--live)",
            }}
          >
            Yang masih perlu dibangun: {platform.pendingWork}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================================================= JOB DETAIL */

function JobDetail({ jobId, onClose, onChanged }) {
  const [job, setJob] = useState(null);
  const [logs, setLogs] = useState([]);
  const [attempts, setAttempts] = useState([]);
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
      setAttempts(json.data.attempts || []);
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
        <div>
          chain: <span style={{ color: "var(--text-mid)" }}>{job.chain}</span>
          {job.chain_id ? ` (id ${job.chain_id})` : ""}
          {job.rpc_url ? " · RPC custom" : " · RPC publik"}
        </div>
        <div>
          anti-revert:{" "}
          <span style={{ color: job.abort_on_revert === false ? "var(--live)" : "var(--crypto)" }}>
            {job.abort_on_revert === false ? "OFF" : "ON"}
          </span>
          {" · "}maks {job.max_attempts || 3} percobaan/wallet
        </div>
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
                <span
                  style={{
                    color: r.success
                      ? "var(--crypto)"
                      : r.prevented
                      ? "var(--live)"
                      : r.unconfirmed
                      ? "var(--live)"
                      : "#f87171",
                    minWidth: 62,
                  }}
                >
                  {r.success
                    ? "OK"
                    : r.prevented
                    ? "DICEGAH"
                    : r.unconfirmed
                    ? "CEK TX"
                    : "GAGAL"}
                </span>
                <span style={{ color: "var(--indigo-dim)" }}>{short(r.address)}</span>
                {r.txHash ? (
                  <a
                    href={
                      job.chain === "base" ? `https://basescan.org/tx/${r.txHash}`
                      : job.chain === "arbitrum" ? `https://arbiscan.io/tx/${r.txHash}`
                      : job.chain === "optimism" ? `https://optimistic.etherscan.io/tx/${r.txHash}`
                      : job.chain === "polygon" ? `https://polygonscan.com/tx/${r.txHash}`
                      : job.chain === "zora" ? `https://explorer.zora.energy/tx/${r.txHash}`
                      : job.chain === "blast" ? `https://blastscan.io/tx/${r.txHash}`
                      : job.chain === "avalanche" ? `https://snowtrace.io/tx/${r.txHash}`
                      : job.chain === "sei" ? `https://seitrace.com/tx/${r.txHash}`
                      : job.chain === "ape_chain" ? `https://apescan.io/tx/${r.txHash}`
                      : job.chain === "ronin" ? `https://app.roninchain.com/tx/${r.txHash}`
                      : job.chain === "ink" ? `https://explorer.inkonchain.com/tx/${r.txHash}`
                      : job.chain === "robinhood" ? `https://robinhoodchain.blockscout.com/tx/${r.txHash}`
                      : `https://etherscan.io/tx/${r.txHash}`
                    }
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

          {/* Ringkasan pengaman. `prevented` BUKAN kegagalan — itu gas yang
              berhasil diselamatkan sebelum tx dikirim. */}
          {job.preflight && (
            <div
              style={{
                marginTop: 9,
                fontSize: 10,
                color: "var(--text-dim)",
                lineHeight: 1.75,
                paddingTop: 8,
                borderTop: "1px solid var(--border)",
              }}
            >
              {job.preflight.prevented > 0 && (
                <div style={{ color: "var(--live)" }}>
                  {job.preflight.prevented} tx dicegah sebelum kirim — gas tidak terbuang
                </div>
              )}
              {job.preflight.unconfirmed > 0 && (
                <div style={{ color: "var(--live)" }}>
                  {job.preflight.unconfirmed} tx terkirim tapi status tidak jelas — cek manual di explorer
                </div>
              )}
              {Array.isArray(job.preflight.rpc) &&
                job.preflight.rpc
                  .filter((r) => r.ok > 0 || r.fail > 0)
                  .map((r, i) => (
                    <div key={i}>
                      RPC {r.host}: {r.ok} ok
                      {r.fail > 0 && (
                        <span style={{ color: "#f87171" }}> · {r.fail} gagal</span>
                      )}
                    </div>
                  ))}
            </div>
          )}
        </div>
      )}

      {/* Riwayat percobaan: ini yang memperlihatkan auto-retry bekerja. */}
      {attempts.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label style={label}>PERCOBAAN ({attempts.length})</label>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 3,
              maxHeight: 150,
              overflowY: "auto",
              background: "var(--bg2)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "7px 9px",
            }}
          >
            {attempts.map((a) => {
              const color =
                a.outcome === "SUCCESS"
                  ? "var(--crypto)"
                  : a.outcome === "SENT"
                  ? "var(--indigo-dim)"
                  : a.outcome === "PREFLIGHT_FAIL"
                  ? "var(--live)"
                  : "#f87171";
              return (
                <div key={a.id} style={{ fontSize: 9.5, display: "flex", gap: 6, alignItems: "baseline" }}>
                  <span style={{ color: "var(--text-dim)", minWidth: 16 }}>
                    #{a.attempt || "-"}
                  </span>
                  <span style={{ color: "var(--indigo-dim)", minWidth: 74 }}>
                    {short(a.wallet_address)}
                  </span>
                  <span style={{ color, minWidth: 88 }}>{a.outcome}</span>
                  {a.error_kind && (
                    <span style={{ color: "var(--text-dim)" }}>{a.error_kind}</span>
                  )}
                  {a.rpc_host && (
                    <span style={{ color: "var(--text-dim)", fontSize: 9 }}>{a.rpc_host}</span>
                  )}
                  {a.duration_ms != null && (
                    <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 9 }}>
                      {a.duration_ms}ms
                    </span>
                  )}
                </div>
              );
            })}
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
  const [walletLimit, setWalletLimit] = useState(2);
  const [chains, setChains] = useState([]);
  const [platforms, setPlatforms] = useState([]);
  const [activePlatform, setActivePlatform] = useState("opensea");
  const [jobs, setJobs] = useState([]);
  const [openJob, setOpenJob] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const loadWallets = useCallback(async () => {
    const res = await fetch("/api/aco/wallets", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      setWallets(json.data || []);
      // Batas wallet datang dari server, bukan hardcode di UI — kalau nanti
      // diubah di API, UI ikut sendiri.
      if (json.limit) setWalletLimit(json.limit);
    }
  }, []);

  const loadChains = useCallback(async () => {
    const res = await fetch("/api/aco/rpcs", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      setChains(json.data || []);
    }
  }, []);

  const loadPlatforms = useCallback(async () => {
    const res = await fetch("/api/aco/platforms", { cache: "no-store" });
    if (res.ok) {
      const json = await res.json();
      setPlatforms(json.data || []);
    }
  }, []);

  // Job difilter per platform supaya tiap section cuma menampilkan miliknya.
  const loadJobs = useCallback(async () => {
    const res = await fetch(`/api/aco/jobs?platform=${activePlatform}`, {
      cache: "no-store",
    });
    if (res.ok) {
      const json = await res.json();
      setJobs(json.data || []);
    }
    setLoaded(true);
  }, [activePlatform]);

  useEffect(() => {
    loadWallets();
    loadChains();
    loadPlatforms();
  }, [loadWallets, loadChains, loadPlatforms]);

  useEffect(() => {
    setLoaded(false);
    setOpenJob(null);
    loadJobs();
  }, [loadJobs]);

  // Refresh daftar job berkala supaya status berubah sendiri saat worker
  // memproses. Detail job punya polling sendiri yang lebih cepat.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) loadJobs();
    }, 8000);
    return () => clearInterval(t);
  }, [loadJobs]);

  const activeCount = jobs.filter((j) => ["QUEUED", "CLAIMED", "RUNNING"].includes(j.status)).length;
  const current = platforms.find((p) => p.id === activePlatform);
  const ready = current?.status === "ready";

  return (
    <main style={{ maxWidth: 1400, margin: "0 auto", padding: "22px 20px 60px" }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1, color: "var(--text)" }}>
            <span style={{ color: "var(--indigo-dim)" }}>~/</span>aco
          </h1>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {wallets.length}/{walletLimit} wallet · {chains.length} chain · {activeCount} job aktif
          </span>
        </div>
        <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.7 }}>
          Anti-revert · auto-retry · anti rate-limit · RPC fallback. Worker di
          VPS yang eksekusi, browser boleh ditutup.
        </p>
      </div>

      {/* Tab platform. Wallet & RPC dipakai bersama semua platform, jadi
          panel kiri tidak ikut berganti. */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 16,
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap",
        }}
      >
        {platforms.map((p) => {
          const on = p.id === activePlatform;
          const soon = p.status !== "ready";
          return (
            <button
              key={p.id}
              onClick={() => setActivePlatform(p.id)}
              style={{
                background: on ? "var(--bg2)" : "transparent",
                border: "1px solid var(--border)",
                borderBottom: on ? "1px solid var(--bg2)" : "1px solid transparent",
                borderRadius: "4px 4px 0 0",
                padding: "7px 14px",
                marginBottom: -1,
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: on ? "var(--text)" : "var(--text-dim)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {p.label}
              {soon && (
                <span style={{ fontSize: 8.5, color: "var(--live)", letterSpacing: 0.5 }}>
                  SOON
                </span>
              )}
            </button>
          );
        })}
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
          <WalletManager wallets={wallets} limit={walletLimit} onChange={loadWallets} />
          <OpenseaKeyPanel />
          <RpcManager chains={chains} onChange={loadChains} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!current ? (
            <div style={{ ...panel, fontSize: 11.5, color: "var(--text-dim)" }}>memuat…</div>
          ) : !ready ? (
            <PlatformComingSoon platform={current} />
          ) : openJob ? (
            <JobDetail
              jobId={openJob}
              onClose={() => setOpenJob(null)}
              onChanged={loadJobs}
            />
          ) : (
            <JobCreator
              wallets={wallets}
              chains={chains}
              platform={activePlatform}
              onCreated={() => { loadJobs(); }}
            />
          )}

          <div style={panel}>
            <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.8, color: "var(--text)", marginBottom: 12 }}>
              RIWAYAT JOB {current ? `— ${current.label.toUpperCase()}` : ""}
            </h2>

            {!loaded ? (
              <p style={{ fontSize: 11.5, color: "var(--text-dim)" }}>memuat…</p>
            ) : jobs.length === 0 ? (
              <p style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.7 }}>
                {ready
                  ? "Belum ada job. Bikin di atas."
                  : `Belum ada job ${current?.label ?? ""} — platform ini belum aktif.`}
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
