"use client";

import { useState } from "react";

/* Gaya disamakan dengan AcoDashboard supaya panelnya tidak terasa nyempil. */
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
  if (kind === "primary") return { ...base, background: "var(--indigo)", color: "#fff" };
  return { ...base, background: "transparent", borderColor: "var(--border)", color: "var(--text-mid)" };
}

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/**
 * Panel bikin job "Mint by Contract".
 *
 * Bedanya dengan JobCreator OpenSea: tidak ada slug dan tidak ada daftar stage.
 * User cuma menempel alamat kontrak, lalu tombol ANALISA mengambil ABI otomatis
 * dan menampilkan fungsi mint + mode (FCFS / whitelist) yang terdeteksi.
 */
export default function ContractJobCreator({ wallets, chains, onCreated }) {
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState("ethereum");
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const [amount, setAmount] = useState(1);
  const [gasLimit, setGasLimit] = useState(300000);
  const [selected, setSelected] = useState([]);
  const [startTime, setStartTime] = useState("");
  const [maxAttempts, setMaxAttempts] = useState(3);

  const valid = /^0x[0-9a-fA-F]{40}$/.test(address.trim());

  async function analyse(e) {
    e.preventDefault();
    if (loading || !valid) return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/aco/contract/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim(), chain }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Gagal menganalisa kontrak.");
        return;
      }
      setInfo(json);
    } catch {
      setError("Tidak bisa menghubungi server.");
    } finally {
      setLoading(false);
    }
  }

  async function createJob() {
    if (creating || !info) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/aco/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: "contract",
          contract_address: info.address,
          chain: info.chain,
          mint_amount: amount,
          gas_limit: gasLimit,
          wallet_ids: selected,
          max_attempts: maxAttempts,
          stage: startTime ? { startTime: new Date(startTime).toISOString() } : {},
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Gagal bikin job.");
        return;
      }
      setAddress("");
      setInfo(null);
      setSelected([]);
      setStartTime("");
      onCreated?.();
    } catch {
      setError("Tidak bisa menghubungi server.");
    } finally {
      setCreating(false);
    }
  }

  const publicFns = (info?.mintFunctions ?? []).filter((f) => !f.ownerOnly);
  const chainRpc = chains?.find((c) => c.identifier === (info?.chain || chain));

  return (
    <div style={panel}>
      <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.8, color: "var(--text)", marginBottom: 12 }}>
        MINT BY CONTRACT
      </h2>

      <form onSubmit={analyse} style={{ display: "flex", gap: 7, marginBottom: 12 }}>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x… alamat kontrak"
          style={{ ...input, flex: 1 }}
        />
        <button type="submit" disabled={loading || !valid} style={btn("ghost", loading || !valid)}>
          {loading ? "…" : "ANALISA"}
        </button>
      </form>

      <div style={{ marginBottom: 12 }}>
        <label style={label}>CHAIN</label>
        <select value={chain} onChange={(e) => setChain(e.target.value)} style={input}>
          {(chains ?? []).map((c) => (
            <option key={c.identifier} value={c.identifier}>
              {c.label} ({c.chainId})
            </option>
          ))}
        </select>
        <p style={{ fontSize: 9.5, color: "var(--text-dim)", marginTop: 4 }}>
          {chainRpc?.hasCustomRpc ? `RPC sendiri (${chainRpc.customHost})` : "RPC publik"}
        </p>
      </div>

      {error && (
        <p style={{ fontSize: 11, color: "#f87171", marginBottom: 12, lineHeight: 1.6 }}>{error}</p>
      )}

      {info && (
        <>
          <div
            style={{
              background: "var(--bg2)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "9px 11px",
              marginBottom: 12,
              fontSize: 11,
              lineHeight: 1.8,
              color: "var(--text-mid)",
            }}
          >
            <div>
              <span style={{ color: "var(--text-dim)" }}>abi </span>
              {info.abiSource}
              {info.verified ? (
                <span style={{ color: "var(--live)" }}> · verified</span>
              ) : (
                <span style={{ color: "var(--crypto)" }}>
                  {" "}· tidak verified, {info.selectorsNamed}/{info.selectorsTotal} selector dikenali
                </span>
              )}
            </div>
            {info.proxyOf && (
              <div>
                <span style={{ color: "var(--text-dim)" }}>proxy → </span>
                {short(info.proxyOf)}
              </div>
            )}
            <div>
              <span style={{ color: "var(--text-dim)" }}>mode </span>
              <span style={{ color: info.mode.mode === "FCFS" ? "var(--live)" : "var(--crypto)" }}>
                {info.mode.mode}
              </span>
              <span style={{ color: "var(--text-dim)" }}> — {info.mode.reason}</span>
            </div>
            {info.state?.name && (
              <div>
                <span style={{ color: "var(--text-dim)" }}>nama </span>
                {info.state.name}
                {info.state.symbol ? ` (${info.state.symbol})` : ""}
              </div>
            )}
            {info.state?.totalSupply != null && (
              <div>
                <span style={{ color: "var(--text-dim)" }}>supply </span>
                {info.state.totalSupply}
                {info.state.MAX_SUPPLY ? ` / ${info.state.MAX_SUPPLY}` : ""}
              </div>
            )}
            <div>
              <span style={{ color: "var(--text-dim)" }}>harga </span>
              {info.priceWei == null
                ? "tidak terbaca"
                : info.priceWei === "0"
                ? "gratis"
                : `${info.priceWei} wei`}
            </div>
          </div>

          <label style={label}>FUNGSI MINT TERDETEKSI ({publicFns.length})</label>
          <div style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            {publicFns.length === 0 ? (
              <p style={{ fontSize: 11, color: "#f87171", lineHeight: 1.6 }}>
                Tidak ada fungsi mint publik yang terdeteksi. Job tetap bisa dibuat, tapi
                kemungkinan besar simulasi tidak akan lolos.
              </p>
            ) : (
              publicFns.map((f, i) => (
                <div
                  key={f.signature}
                  style={{
                    fontSize: 10.5,
                    color: i === 0 ? "var(--text)" : "var(--text-dim)",
                    background: i === 0 ? "var(--indigo-glow)" : "transparent",
                    border: `1px solid ${i === 0 ? "var(--indigo)" : "var(--border)"}`,
                    borderRadius: 3,
                    padding: "5px 9px",
                    display: "flex",
                    gap: 7,
                    alignItems: "center",
                  }}
                >
                  <span>{f.signature}</span>
                  {f.payable && <span style={{ color: "var(--crypto)", fontSize: 9 }}>payable</span>}
                  {f.needsProof && <span style={{ color: "var(--nft)", fontSize: 9 }}>proof</span>}
                  {i === 0 && (
                    <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--indigo-dim)" }}>
                      dicoba pertama
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          <p style={{ fontSize: 9.5, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.7 }}>
            Worker mencoba tiap fungsi dengan beberapa bentuk argumen dan hanya mengirim tx
            yang lolos simulasi. Tebakan yang salah tidak membakar gas.
          </p>

          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>AMOUNT / WALLET</label>
              <input
                type="number"
                min={1}
                max={100}
                value={amount}
                onChange={(e) => setAmount(Math.max(1, Math.min(parseInt(e.target.value) || 1, 100)))}
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

          <div style={{ marginBottom: 12 }}>
            <label style={label}>WAKTU MULAI (kosongkan = langsung)</label>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={input}
            />
            <p style={{ fontSize: 9.5, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.7 }}>
              {info.mode.gated && !startTime
                ? "Mint belum dibuka di kontrak. Tanpa jadwal, worker menghammer simulasi sampai terbuka."
                : "Kalau diisi, worker menunggu sampai waktu itu baru menghammer."}
            </p>
          </div>

          <label style={label}>
            WALLET YANG DIPAKAI ({selected.length}/{wallets?.length ?? 0} dipilih)
          </label>
          {!wallets?.length ? (
            <p style={{ fontSize: 11, color: "var(--live)", marginBottom: 12 }}>
              Import wallet dulu di panel sebelah.
            </p>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 12 }}>
              {wallets.map((w) => {
                const on = selected.includes(w.id);
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() =>
                      setSelected((p) => (p.includes(w.id) ? p.filter((x) => x !== w.id) : [...p, w.id]))
                    }
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
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={label}>PERCOBAAN / WALLET</label>
            <input
              type="number"
              min={1}
              max={10}
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Math.max(1, Math.min(parseInt(e.target.value) || 3, 10)))}
              style={input}
            />
            <p style={{ fontSize: 9.5, color: "var(--text-dim)", marginTop: 4 }}>
              1 percobaan = 100 simulasi (jeda 200ms) sebelum menyerah.
            </p>
          </div>

          <div
            style={{
              background: "rgba(127,29,29,0.15)",
              border: "1px solid #7f1d1d",
              borderRadius: 4,
              padding: "9px 11px",
              marginBottom: 14,
              fontSize: 10.5,
              color: "#fca5a5",
              lineHeight: 1.7,
            }}
          >
            PAKAI WALLET BURNER. Mint langsung ke kontrak tanpa perantara marketplace —
            kalau kontraknya jahat, dana di wallet bisa habis.
          </div>

          <button
            type="button"
            onClick={createJob}
            disabled={creating || selected.length === 0}
            style={{ ...btn("primary", creating || selected.length === 0), width: "100%" }}
          >
            {creating ? "MEMBUAT…" : "BUAT JOB"}
          </button>
        </>
      )}
    </div>
  );
}
