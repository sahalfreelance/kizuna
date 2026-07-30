export default function TerminalWindow({ label, accent = "var(--indigo)", children }) {
  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--border)",
        borderTop: `2px solid ${accent}`,
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg2)",
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57", display: "inline-block" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#febc2e", display: "inline-block" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840", display: "inline-block" }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-dim)", letterSpacing: 1 }}>
          {label}
        </span>
      </div>
      <div style={{ padding: "28px 32px" }}>{children}</div>
    </div>
  );
}
