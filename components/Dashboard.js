"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GarapanCard from "./GarapanCard";
import TerminalWindow from "./TerminalWindow";
import MintInfoBar from "./MintInfoBar";
import { getEffectiveStatus } from "@/lib/raffleStatus";

const CATEGORIES = [
  { key: "NFT",     label: "NFT",     color: "var(--nft)"     },
  { key: "RAFFLE",  label: "RAFFLE",  color: "var(--live)"    },
  { key: "CRYPTO",  label: "CRYPTO",  color: "var(--airdrop)" },
];

const POLL_INTERVAL_MS = 8000;

export default function Dashboard({ entries: initialEntries }) {
  const [entries, setEntries] = useState(initialEntries);
  const [category, setCategory] = useState("NFT");
  const [raffleStatus, setRaffleStatus] = useState("LIVE");
  const [isSyncing, setIsSyncing] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const entriesRef = useRef(initialEntries);
  const seenIdsRef = useRef(new Set(initialEntries.map((e) => e.id)));

  // Auto-sync: ngecek data baru di background tiap beberapa detik, biar
  // garapan baru dari bot/admin muncul otomatis tanpa perlu refresh manual.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (document.hidden) return;

      setIsSyncing(true);
      try {
        const res = await fetch("/api/garapan", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled || !json.data) return;

        // Tandain garapan yang baru muncul (belum pernah keliatan sebelumnya)
        // buat badge notifikasi di tombol bell.
        const newOnes = json.data.filter((e) => !seenIdsRef.current.has(e.id));
        if (newOnes.length > 0) {
          setNewCount((c) => c + newOnes.length);
        }
        json.data.forEach((e) => seenIdsRef.current.add(e.id));

        const changed =
          JSON.stringify(json.data) !== JSON.stringify(entriesRef.current);
        if (changed) {
          entriesRef.current = json.data;
          setEntries(json.data);
        }
      } catch {
        // diem-diem aja, coba lagi di siklus berikutnya
      } finally {
        if (!cancelled) setIsSyncing(false);
      }
    }

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", poll);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
    };
  }, []);

  const filtered = useMemo(() => {
    if (category !== "RAFFLE") return entries.filter(e => e.category === category);
    return entries.filter(e => e.category === "RAFFLE" && getEffectiveStatus(e) === raffleStatus);
  }, [entries, category, raffleStatus]);

  const mintEntries = useMemo(
    () => entries.filter((e) => e.category === "MINT"),
    [entries]
  );

  const activeColor = CATEGORIES.find(c => c.key === category)?.color || "var(--indigo)";

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 20px 80px" }}>
      <MintInfoBar entries={mintEntries} />
      <TerminalWindow label="root@kizuna: ~/list_garapan.sh" accent={activeColor}>
        {/* header */}
        <div style={{ marginBottom: 28, paddingBottom: 20, borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", letterSpacing: 2, marginBottom: 6 }}>
              <span style={{ color: "var(--indigo-hi)" }}>root@kizuna</span>
              <span style={{ color: "var(--text-dim)" }}>:~$</span>
              <span style={{ color: "var(--text-mid)", marginLeft: 6 }}>./list_garapan.sh</span>
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", letterSpacing: 0.5 }}
              className="cursor">
              Rangkuman garapan komunitas
            </h1>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6 }}>
              {entries.length} entries found &nbsp;·&nbsp; sorted by latest
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              onClick={() => setNewCount(0)}
              title={newCount > 0 ? `${newCount} garapan baru sejak terakhir dilihat` : "Gak ada notifikasi baru"}
              style={{
                position: "relative",
                background: "transparent",
                border: `1px solid ${newCount > 0 ? "var(--live)" : "var(--border)"}`,
                borderRadius: 6,
                padding: "5px 9px",
                cursor: "pointer",
                fontSize: 13,
                lineHeight: 1,
                color: newCount > 0 ? "var(--live)" : "var(--text-dim)",
                transition: "border-color 0.15s, color 0.15s",
              }}
            >
              🔔
              {newCount > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    background: "var(--live)",
                    color: "#0f1115",
                    fontSize: 10,
                    fontWeight: 700,
                    borderRadius: "50%",
                    minWidth: 16,
                    height: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 3px",
                  }}
                >
                  {newCount > 9 ? "9+" : newCount}
                </span>
              )}
            </button>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: "var(--text-dim)",
                letterSpacing: 1,
              }}
              title="Otomatis nge-cek garapan baru tiap beberapa detik"
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--crypto)",
                  display: "inline-block",
                  opacity: isSyncing ? 1 : 0.4,
                  transition: "opacity 0.3s",
                }}
              />
              LIVE SYNC
            </div>
          </div>
        </div>

        {/* category tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
          {CATEGORIES.map(c => {
            const active = category === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "7px 14px",
                  border: `1px solid ${active ? c.color : "var(--border)"}`,
                  borderRadius: 4,
                  background: active ? "var(--panel-hover)" : "transparent",
                  color: active ? c.color : "var(--text-dim)",
                  fontSize: 12, fontWeight: active ? 700 : 400,
                  letterSpacing: 1,
                  transition: "all 0.15s",
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: active ? c.color : "var(--text-dim)",
                  display: "inline-block",
                }} />
                {c.label}
              </button>
            );
          })}
        </div>

        {/* raffle sub-filter */}
        {category === "RAFFLE" && (
          <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
            {["LIVE", "PAST"].map(s => (
              <button
                key={s}
                onClick={() => setRaffleStatus(s)}
                style={{
                  padding: "5px 12px",
                  borderRadius: 4, fontSize: 11, letterSpacing: 1,
                  border: `1px solid ${raffleStatus === s ? (s === "LIVE" ? "var(--live)" : "var(--text-dim)") : "var(--border)"}`,
                  background: raffleStatus === s ? "var(--panel-hover)" : "transparent",
                  color: s === "LIVE" ? "var(--live)" : "var(--text-mid)",
                  opacity: raffleStatus === s ? 1 : 0.5,
                }}
              >
                {s === "LIVE" ? "● LIVE" : "○ PAST"}
              </button>
            ))}
          </div>
        )}

        {/* grid / empty */}
        {filtered.length === 0 ? (
          <div style={{
            border: "1px dashed var(--border)", borderRadius: 6,
            padding: "48px 20px", textAlign: "center",
            color: "var(--text-dim)", fontSize: 12, letterSpacing: 1,
          }}>
            <div style={{ marginBottom: 8, color: "var(--indigo-dim)" }}>bash: entries: not found</div>
            <div>Belum ada garapan di kategori ini.</div>
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
            gap: 12,
          }}>
            {filtered.map((entry, i) => (
              <GarapanCard key={entry.id} entry={entry} index={i} />
            ))}
          </div>
        )}
      </TerminalWindow>
    </main>
  );
}
