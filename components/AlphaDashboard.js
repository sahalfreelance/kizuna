"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AlphaCard from "./AlphaCard";

// Section utama + sub-tab di dalamnya. `source: null` = tampilkan semua
// sumber di section itu.
const SECTIONS = [
  {
    key: "TRENDING",
    label: "TRENDING",
    color: "var(--live)",
    hint: "project dengan lonjakan key followers",
    tabs: [{ key: null, label: "ALL" }],
  },
  {
    key: "NEWS",
    label: "NEWS",
    color: "var(--crypto)",
    hint: "launch & ringkasan harian",
    tabs: [
      { key: null, label: "ALL" },
      { key: "launches", label: "LAUNCHES" },
      { key: "summary", label: "SUMMARY" },
    ],
  },
  {
    key: "FEED",
    label: "FEED",
    color: "var(--nft)",
    hint: "tweet & catatan komunitas",
    tabs: [
      { key: null, label: "ALL" },
      { key: "tweets", label: "TWEETS" },
      { key: "notes", label: "NOTES" },
    ],
  },
];

const POLL_INTERVAL_MS = 20000;

// Polling minta PER SECTION, bukan sekali ambil semua.
//
// Bug sebelumnya: muatan awal halaman pakai limit 300 (semua data), tapi
// polling pakai limit=100 lalu MENIMPA seluruh state. Data diurut
// source_timestamp DESC, dan item TRENDING (profil project) timestamp-nya
// lebih tua daripada tweet/launch yang masuk terus -- jadi TRENDING
// kepotong habis dari 100 teratas dan tab-nya jadi kosong setelah 20 detik.
//
// Per-section bikin tiap section punya kuota sendiri, jadi nggak bisa saling
// menggusur, dan tetap aman walau data tumbuh jadi ribuan.
const POLL_LIMIT_PER_SECTION = 150;

export default function AlphaDashboard({ items: initialItems }) {
  const [items, setItems] = useState(initialItems);
  const [section, setSection] = useState("TRENDING");
  const [sourceTab, setSourceTab] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [newCount, setNewCount] = useState(0);

  const itemsRef = useRef(initialItems);
  const seenRef = useRef(new Set(initialItems.map((i) => i.id)));

  // Polling di background biar item baru dari forwarder muncul tanpa refresh.
  // Interval-nya lebih longgar dari dashboard utama (20s vs 8s) karena data
  // Alphagate cuma masuk tiap forwarder jalan (~15 menit), jadi polling cepat
  // cuma bikin request sia-sia.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (document.hidden) return;

      setIsSyncing(true);
      try {
        // Satu request per section supaya section yang timestamp-nya tua
        // (TRENDING) nggak tergusur oleh section yang datanya sering masuk.
        const results = await Promise.all(
          SECTIONS.map((s) =>
            fetch(
              `/api/alpha?section=${s.key}&limit=${POLL_LIMIT_PER_SECTION}`,
              { cache: "no-store" }
            )
              .then((res) => (res.ok ? res.json() : null))
              .catch(() => null)
          )
        );

        if (cancelled) return;

        // Kalau ADA section yang gagal, jangan timpa state — lebih baik
        // pakai data lama daripada menampilkan section kosong palsu.
        if (results.some((r) => !r || !Array.isArray(r.data))) return;

        const merged = results.flatMap((r) => r.data);

        const fresh = merged.filter((i) => !seenRef.current.has(i.id));
        if (fresh.length > 0) setNewCount((c) => c + fresh.length);
        merged.forEach((i) => seenRef.current.add(i.id));

        if (JSON.stringify(merged) !== JSON.stringify(itemsRef.current)) {
          itemsRef.current = merged;
          setItems(merged);
        }
      } catch {
        // diem-diem aja, coba lagi siklus berikutnya
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

  const activeSection = SECTIONS.find((s) => s.key === section) || SECTIONS[0];

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (i.section !== section) return false;
      if (sourceTab && i.source !== sourceTab) return false;
      if (categoryFilter && i.category !== categoryFilter) return false;
      return true;
    });
  }, [items, section, sourceTab, categoryFilter]);

  const counts = useMemo(() => {
    const out = {};
    for (const s of SECTIONS) {
      out[s.key] = items.filter((i) => i.section === s.key).length;
    }
    return out;
  }, [items]);

  const nftSynced = useMemo(
    () => items.filter((i) => i.category === "NFT" && i.pushed_to_garapan).length,
    [items]
  );

  function switchSection(key) {
    setSection(key);
    setSourceTab(null); // reset sub-tab, sumber di section lain beda
  }

  return (
    <main style={{ maxWidth: 1400, margin: "0 auto", padding: "22px 20px 60px" }}>
      {/* header */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1, color: "var(--text)" }}>
            <span style={{ color: "var(--indigo-dim)" }}>~/</span>alpha
          </h1>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            data dari alphagate · {items.length} item
          </span>
          {nftSynced > 0 && (
            <span style={{ fontSize: 11, color: "var(--crypto)", opacity: 0.8 }}>
              {nftSynced} NFT ter-sync ke dashboard
            </span>
          )}
          {isSyncing && (
            <span style={{ fontSize: 10.5, color: "var(--indigo-dim)", opacity: 0.7 }}>
              syncing…
            </span>
          )}
          {newCount > 0 && (
            <button
              onClick={() => setNewCount(0)}
              style={{
                fontSize: 10.5,
                color: "var(--live)",
                background: "transparent",
                border: "1px solid var(--live)",
                borderRadius: 3,
                padding: "1px 6px",
                cursor: "pointer",
              }}
            >
              {newCount} baru
            </button>
          )}
        </div>
        <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
          {activeSection.hint}
        </p>
      </div>

      {/* section tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {SECTIONS.map((s) => {
          const active = s.key === section;
          return (
            <button
              key={s.key}
              onClick={() => switchSection(s.key)}
              style={{
                fontSize: 11.5,
                letterSpacing: 1,
                fontWeight: active ? 700 : 400,
                color: active ? "var(--bg)" : "var(--text-dim)",
                background: active ? s.color : "transparent",
                border: `1px solid ${active ? s.color : "var(--border)"}`,
                borderRadius: 4,
                padding: "5px 12px",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {s.label}
              <span style={{ opacity: 0.7, marginLeft: 5, fontSize: 10 }}>
                {counts[s.key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* sub-tab + filter kategori */}
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 18,
          paddingBottom: 12,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {activeSection.tabs.length > 1 &&
          activeSection.tabs.map((t) => {
            const active = t.key === sourceTab;
            return (
              <button
                key={t.label}
                onClick={() => setSourceTab(t.key)}
                style={{
                  fontSize: 10.5,
                  letterSpacing: 0.5,
                  color: active ? "var(--text)" : "var(--text-dim)",
                  background: "transparent",
                  border: `1px solid ${active ? "var(--border-hi)" : "var(--border)"}`,
                  borderRadius: 3,
                  padding: "3px 9px",
                  cursor: "pointer",
                }}
              >
                {t.label}
              </button>
            );
          })}

        <div style={{ marginLeft: "auto", display: "flex", gap: 5, alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>kategori:</span>
          {[
            { key: null, label: "SEMUA", color: "var(--text-dim)" },
            { key: "NFT", label: "NFT", color: "var(--nft)" },
            { key: "CRYPTO", label: "CRYPTO", color: "var(--crypto)" },
          ].map((c) => {
            const active = c.key === categoryFilter;
            return (
              <button
                key={c.label}
                onClick={() => setCategoryFilter(c.key)}
                style={{
                  fontSize: 10,
                  letterSpacing: 0.5,
                  color: active ? c.color : "var(--text-dim)",
                  background: "transparent",
                  border: `1px solid ${active ? c.color : "var(--border)"}`,
                  borderRadius: 3,
                  padding: "2px 7px",
                  cursor: "pointer",
                  opacity: active ? 1 : 0.6,
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* grid */}
      {filtered.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--border)",
            borderRadius: 6,
            padding: "40px 20px",
            textAlign: "center",
            color: "var(--text-dim)",
            fontSize: 12,
          }}
        >
          <p>belum ada data di section ini.</p>
          <p style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
            jalanin forwarder alphagate dulu, nanti muncul otomatis di sini.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: 14,
          }}
        >
          {filtered.map((item, i) => (
            <AlphaCard key={item.id} item={item} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}
