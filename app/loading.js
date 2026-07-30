export default function Loading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
      }}
    >
      <div style={{ position: "relative", width: 76, height: 76 }}>
        <div
          style={{
            position: "absolute",
            inset: -10,
            borderRadius: "50%",
            border: "2px solid transparent",
            borderTopColor: "var(--indigo)",
            borderRightColor: "var(--indigo-dim)",
            animation: "ring-spin 0.9s linear infinite",
          }}
        />
        <img
          src="/logo.jpg"
          alt="Loading"
          style={{
            width: 76,
            height: 76,
            borderRadius: 14,
            display: "block",
            animation: "logo-pulse 1.3s ease-in-out infinite",
          }}
        />
      </div>
      <div
        className="cursor"
        style={{ fontSize: 12, color: "var(--text-dim)", letterSpacing: 3 }}
      >
        LOADING
      </div>
    </div>
  );
}
