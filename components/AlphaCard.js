"use client";

const CATEGORY_COLOR = {
  NFT: "var(--nft)",
  CRYPTO: "var(--crypto)",
};

const SOURCE_LABEL = {
  trending: "TRENDING",
  launches: "LAUNCH",
  summary: "SUMMARY",
  notes: "NOTE",
  tweets: "TWEET",
};

const URL_REGEX = /(https?:\/\/[^\s]+)/g;

function linkify(text) {
  return text.split(URL_REGEX).map((part, i) =>
    part.startsWith("http") ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{
          color: "var(--indigo-hi)",
          textDecoration: "underline",
          wordBreak: "break-all",
        }}
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("en-US") : "-";
}

function growthText(n) {
  if (typeof n !== "number") return null;
  return n > 0 ? `+${fmt(n)}` : fmt(n);
}

function timeAgo(value) {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;

  const sec = Math.max(0, (Date.now() - then) / 1000);
  if (sec < 60) return `${Math.floor(sec)} detik lalu`;
  if (sec < 3600) return `${Math.floor(sec / 60)} menit lalu`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} jam lalu`;
  if (sec < 2592000) return `${Math.floor(sec / 86400)} hari lalu`;
  if (sec < 31536000) return `${Math.floor(sec / 2592000)} bulan lalu`;
  return `${Math.floor(sec / 31536000)} tahun lalu`;
}

export default function AlphaCard({ item, index = 0 }) {
  const color = CATEGORY_COLOR[item.category] || "var(--text-dim)";
  const description = item.description || "";

  const growth = [
    ["1d", item.key_followers_growth_1d],
    ["3d", item.key_followers_growth_3d],
    ["7d", item.key_followers_growth_7d],
  ].filter(([, v]) => typeof v === "number");

  const chips = [
    ...(item.chains || []).map((c) => ({ text: c, tone: "chain" })),
    ...(item.tags || []).map((t) => ({ text: t, tone: "tag" })),
  ];

  return (
    <div
      className="card-anim"
      style={{
        animationDelay: `${index * 35}ms`,
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderTop: `2px solid ${color}`,
        borderRadius: 6,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 9,
        // height 100% + marginTop:auto di blok aksi = tombol semua card rata
        // bawah, sama seperti GarapanCard. Tanpa ukur tinggi di JS.
        height: "100%",
      }}
    >
      {/* header: badge sumber + kategori + waktu */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          flexWrap: "wrap",
          fontSize: 10.5,
          color: "var(--text-dim)",
        }}
      >
        <span style={{ color: "var(--indigo-dim)" }}>
          [{SOURCE_LABEL[item.source] || item.source}]
        </span>
        {item.category && <span style={{ color }}>{item.category}</span>}
        {item.pushed_to_garapan && (
          <span
            title="Sudah masuk dashboard NFT"
            style={{
              fontSize: 9.5,
              color: "var(--crypto)",
              border: "1px solid var(--crypto)",
              borderRadius: 3,
              padding: "0 4px",
              opacity: 0.75,
            }}
          >
            ✓ SYNCED
          </span>
        )}
        <span style={{ marginLeft: "auto" }}>{timeAgo(item.source_timestamp)}</span>
      </div>

      {/* gambar: cuma buat item yang punya media beneran (tweet/banner),
          bukan avatar -- avatar ditaruh kecil di baris identitas */}
      {item.image_url && item.image_url !== item.avatar_url && (
        <img
          src={item.image_url}
          alt=""
          loading="lazy"
          style={{
            width: "100%",
            height: 130,
            objectFit: "cover",
            borderRadius: 4,
            border: "1px solid var(--border)",
            display: "block",
          }}
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}

      {/* identitas */}
      {item.username && (
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {item.avatar_url && (
            <img
              src={item.avatar_url}
              alt=""
              loading="lazy"
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: "1px solid var(--border)",
                flexShrink: 0,
              }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          <a
            href={`https://x.com/${item.username}`}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 11.5,
              color: "var(--text-mid)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.display_name ? `${item.display_name} ` : ""}
            <span style={{ color: "var(--indigo-dim)" }}>@{item.username}</span>
          </a>
        </div>
      )}

      {/* judul */}
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", lineHeight: 1.45 }}>
        <span style={{ color: "var(--indigo-dim)", marginRight: 5 }}>&gt;</span>
        {item.title}
      </div>

      {/* deskripsi — dipotong 3 baris, tanpa tombol expand: tinggi card
          seragam dan tombol tetap rata bawah. Teks penuh ada di link. */}
      {description && (
        <>
          <p
            style={{
              fontSize: 11.5,
              color: "var(--text-mid)",
              lineHeight: 1.6,
              margin: 0,
              whiteSpace: "pre-line",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {linkify(description)}
          </p>
        </>
      )}

      {/* metrik */}
      {(typeof item.followers_count === "number" ||
        typeof item.key_followers_count === "number") && (
        <div style={{ fontSize: 10.5, color: "var(--text-dim)", display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span>
            followers <span style={{ color: "var(--text-mid)" }}>{fmt(item.followers_count)}</span>
          </span>
          <span>
            key <span style={{ color: "var(--nft)" }}>{fmt(item.key_followers_count)}</span>
          </span>
          {typeof item.followers_when_found === "number" && (
            <span>
              saat ditemukan{" "}
              <span style={{ color: "var(--text-mid)" }}>{fmt(item.followers_when_found)}</span>
            </span>
          )}
        </div>
      )}

      {/* growth key followers -- sinyal paling penting di trending */}
      {growth.length > 0 && (
        <div style={{ fontSize: 10.5, color: "var(--text-dim)", display: "flex", gap: 10 }}>
          <span>growth key</span>
          {growth.map(([label, value]) => (
            <span key={label}>
              {label}{" "}
              <span style={{ color: value > 0 ? "var(--crypto)" : "var(--text-mid)" }}>
                {growthText(value)}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* chain & tag */}
      {chips.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {chips.map((chip, i) => (
            <span
              key={`${chip.text}-${i}`}
              style={{
                fontSize: 9.5,
                letterSpacing: 0.5,
                color: chip.tone === "chain" ? "var(--crypto)" : "var(--text-dim)",
                border: `1px solid ${chip.tone === "chain" ? "var(--crypto)" : "var(--border)"}`,
                borderRadius: 3,
                padding: "1px 5px",
                opacity: 0.8,
              }}
            >
              {chip.text}
            </span>
          ))}
        </div>
      )}

      {/* contract address: bisa di-copy, jangan cuma dipajang */}
      {(item.contracts || []).length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {item.contracts.slice(0, 3).map((ca) => (
            <button
              key={ca}
              onClick={() => navigator.clipboard?.writeText(ca)}
              title="klik buat copy"
              style={{
                fontSize: 9.5,
                color: "var(--text-dim)",
                background: "var(--bg2)",
                border: "1px solid var(--border)",
                borderRadius: 3,
                padding: "3px 6px",
                textAlign: "left",
                cursor: "pointer",
                wordBreak: "break-all",
                fontFamily: "var(--font-mono)",
              }}
            >
              {ca}
            </button>
          ))}
        </div>
      )}

      {/* aksi */}
      <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 2 }}>
        {item.link && (
          <a
            href={item.link}
            target="_blank"
            rel="noreferrer"
            style={{
              flex: 1,
              fontSize: 11,
              color: "var(--bg)",
              background: color,
              borderRadius: 4,
              padding: "6px 10px",
              textAlign: "center",
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            ./open →
          </a>
        )}
        {item.secondary_link && (
          <a
            href={item.secondary_link}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 11,
              color: "var(--text-mid)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "6px 10px",
              textAlign: "center",
              letterSpacing: 0.5,
            }}
          >
            site
          </a>
        )}
      </div>
    </div>
  );
}
