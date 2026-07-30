export default function MintInfoBar({ entries }) {
  if (!entries || entries.length === 0) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        fontSize: 11, color: "var(--text-dim)", letterSpacing: 1, marginBottom: 8,
      }}>
        <span style={{ color: "var(--airdrop)" }}>◆</span> MINT INFO FEED
      </div>

      <div style={{
        display: "flex",
        gap: 10,
        overflowX: "auto",
        paddingBottom: 6,
      }}>
        {entries.map((entry) => (
          <div
            key={entry.id}
            style={{
              flex: "0 0 auto",
              width: 220,
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderLeft: "2px solid var(--airdrop)",
              borderRadius: 6,
              padding: "10px 12px",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {entry.image_url && (
                <img
                  src={entry.image_url}
                  alt=""
                  loading="lazy"
                  style={{ width: 32, height: 32, borderRadius: 4, objectFit: "cover", border: "1px solid var(--border)", flexShrink: 0 }}
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              )}
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {entry.title}
              </div>
            </div>

            <div style={{ display: "flex", gap: 6 }}>
              {entry.link && (
                <a
                  href={entry.link}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 10.5, flex: 1, textAlign: "center",
                    background: "var(--airdrop)", color: "var(--bg)",
                    borderRadius: 4, padding: "5px 6px", fontWeight: 700, letterSpacing: 0.5,
                  }}
                >
                  OpenSea ↗
                </a>
              )}
              {entry.secondary_link && (
                <a
                  href={entry.secondary_link}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 10.5, flex: 1, textAlign: "center",
                    background: "transparent", color: "var(--indigo-hi)",
                    border: "1px solid var(--indigo)",
                    borderRadius: 4, padding: "5px 6px", fontWeight: 700, letterSpacing: 0.5,
                  }}
                >
                  𝕏 Twitter
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
