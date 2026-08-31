"use client";

import { getEffectiveStatus } from "@/lib/raffleStatus";

const CATEGORY_COLOR = {
  NFT:     "var(--nft)",
  RAFFLE:  "var(--live)",
  CRYPTO:  "var(--airdrop)",
};

const CATEGORY_LABEL = {
  NFT:     "NFT",
  RAFFLE:  "RAFFLE",
  CRYPTO:  "CRYPTO",
};

export default function GarapanCard({ entry, index = 0 }) {
  const color = CATEGORY_COLOR[entry.category] || "var(--text-dim)";
  const date = new Date(entry.created_at).toLocaleDateString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
  });
  const isLive = entry.category === "RAFFLE" && getEffectiveStatus(entry) === "LIVE";

  return (
    <div
      className="card-anim"
      style={{
        animationDelay: `${index * 40}ms`,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderTop: `2px solid ${color}`,
        borderRadius: 6,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        // height 100% + marginTop:auto di blok meta = tombol semua card rata bawah,
        // tanpa perlu ukur tinggi di JS.
        height: "100%",
        position: "relative",
        transition: "border-color 0.15s, background 0.15s",
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = color.replace("var(", "").replace(")", "")}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = "var(--border)";
        e.currentTarget.style.borderTopColor = color;
      }}
    >
      {/* image */}
      {entry.image_url && (
        <img
          src={entry.image_url}
          alt=""
          loading="lazy"
          style={{
            width: "100%",
            height: 140,
            objectFit: "cover",
            borderRadius: 4,
            border: "1px solid var(--border)",
            display: "block",
          }}
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      )}

      {/* prompt line */}
      <div style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color }}>{`[${CATEGORY_LABEL[entry.category]}]`}</span>
        {isLive && (
          <span style={{
            fontSize: 10,
            color: "var(--live)",
            border: "1px solid var(--live)",
            borderRadius: 3,
            padding: "1px 5px",
            letterSpacing: 1,
            animation: "pulse-glow 2s ease infinite",
          }}>
            ● LIVE
          </span>
        )}
      </div>

      {/* title */}
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", lineHeight: 1.4 }}>
        <span style={{ color: "var(--indigo-dim)", marginRight: 6 }}>&gt;</span>
        {entry.title}
      </div>

      {/* meta — marginTop:auto mendorong meta + tombol ke dasar card */}
      <div style={{
        marginTop: "auto",
        fontSize: 11,
        color: "var(--text-dim)",
        borderTop: "1px solid var(--border)",
        paddingTop: 8,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span><span style={{ color: "var(--indigo-dim)" }}>@</span>{entry.created_by}</span>
        <span>{date}</span>
      </div>

      {entry.link && (
        <a
          href={entry.link}
          target="_blank"
          rel="noreferrer"
          style={{
            fontSize: 12,
            color: "var(--bg)",
            background: color,
            border: "none",
            borderRadius: 4,
            padding: "7px 12px",
            textAlign: "center",
            letterSpacing: 0.5,
            fontWeight: 600,
            transition: "opacity 0.15s",
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.8"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}
        >
          ./open_link.sh →
        </a>
      )}
    </div>
  );
}
