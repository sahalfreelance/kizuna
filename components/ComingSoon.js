import TerminalWindow from "./TerminalWindow";

export default function ComingSoon({ label, title, note }) {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 80px" }}>
      <TerminalWindow label={label} accent="var(--indigo)">
        <div style={{ textAlign: "center", padding: "48px 20px" }}>
          <div style={{ fontSize: 11, color: "var(--indigo-dim)", letterSpacing: 2, marginBottom: 14 }}>
            $ ./{label.split("~/")[1] || "run"}
          </div>
          <h1 style={{ fontSize: 24, margin: "0 0 10px" }}>
            <span style={{ color: "var(--indigo-hi)" }}>&gt;</span> {title}
          </h1>
          <div
            className="cursor"
            style={{ fontSize: 13, color: "var(--text-dim)", letterSpacing: 1, marginBottom: 4 }}
          >
            🚧 COMING SOON
          </div>
          {note && (
            <p style={{ fontSize: 13, color: "var(--text-mid)", maxWidth: 440, margin: "16px auto 0", lineHeight: 1.6 }}>
              {note}
            </p>
          )}
        </div>
      </TerminalWindow>
    </main>
  );
}
