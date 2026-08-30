"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Dialog konfirmasi bertema, pengganti window.confirm().
 *
 * Alasan diganti: window.confirm() dirender oleh browser/OS, jadi tampilannya
 * tidak bisa disesuaikan dengan tema gelap website — kelihatan asing. Selain
 * itu ia MEMBLOKIR thread JS, yang berarti log realtime berhenti diperbarui
 * selama dialog terbuka.
 *
 * Dipakai lewat hook useConfirm() supaya pemanggilannya tetap sesederhana
 * confirm(): `if (await ask({ ... })) { ... }`
 */

const overlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.72)",
  backdropFilter: "blur(3px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
  padding: 20,
  animation: "kzFade 120ms ease-out",
};

const box = {
  background: "var(--bg1, #0e0e11)",
  border: "1px solid var(--border, #26262c)",
  borderRadius: 6,
  maxWidth: 420,
  width: "100%",
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
  animation: "kzRise 140ms ease-out",
};

export default function ConfirmDialog({
  open,
  title = "Konfirmasi",
  message,
  detail = null,
  confirmLabel = "ya, lanjut",
  cancelLabel = "batal",
  danger = false,
  onConfirm,
  onCancel,
}) {
  // Esc = batal, Enter = konfirmasi. Keyboard penting karena dialog ini
  // menggantikan confirm() yang sudah punya perilaku itu.
  useEffect(() => {
    if (!open) return;

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm?.();
      }
    };

    window.addEventListener("keydown", onKey);
    // Cegah scroll latar saat dialog terbuka.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  const accent = danger ? "#f87171" : "var(--indigo, #6366f1)";

  return (
    <div style={overlay} onClick={onCancel} role="presentation">
      <style>{`
        @keyframes kzFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes kzRise {
          from { opacity: 0; transform: translateY(6px) scale(0.985) }
          to   { opacity: 1; transform: translateY(0)   scale(1) }
        }
      `}</style>

      <div
        style={box}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Bar judul mengikuti gaya panel terminal di halaman lain */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 13px",
            borderBottom: "1px solid var(--border, #26262c)",
            background: "var(--bg2, #15151a)",
            borderRadius: "6px 6px 0 0",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: accent }} />
          <span
            style={{
              fontSize: 11,
              letterSpacing: 0.9,
              fontWeight: 700,
              color: "var(--text, #e7e7ea)",
              textTransform: "uppercase",
            }}
          >
            {title}
          </span>
        </div>

        <div style={{ padding: "15px 16px 16px" }}>
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              lineHeight: 1.65,
              color: "var(--text, #e7e7ea)",
            }}
          >
            {message}
          </p>

          {detail && (
            <p
              style={{
                margin: "9px 0 0",
                fontSize: 10.5,
                lineHeight: 1.7,
                color: danger ? "#f87171" : "var(--text-dim, #8b8b95)",
              }}
            >
              {detail}
            </p>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <button onClick={onCancel} style={btnStyle(false, accent)}>
              {cancelLabel}
            </button>
            {/* autoFocus supaya Enter/Tab langsung mengarah ke aksi utama */}
            <button onClick={onConfirm} style={btnStyle(true, accent)} autoFocus>
              {confirmLabel}
            </button>
          </div>

          <div
            style={{
              marginTop: 10,
              fontSize: 9,
              color: "var(--text-dim, #8b8b95)",
              textAlign: "right",
            }}
          >
            enter = lanjut · esc = batal
          </div>
        </div>
      </div>
    </div>
  );
}

function btnStyle(primary, accent) {
  return {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 11,
    padding: "7px 14px",
    borderRadius: 4,
    cursor: "pointer",
    letterSpacing: 0.3,
    background: primary ? accent : "transparent",
    color: primary ? "#fff" : "var(--text-dim, #8b8b95)",
    border: `1px solid ${primary ? accent : "var(--border, #26262c)"}`,
  };
}

/**
 * Hook: menyediakan `ask()` yang mengembalikan Promise<boolean>.
 *
 *   const { ask, dialog } = useConfirm();
 *   if (await ask({ message: "Hapus?" })) { ... }
 *   return <>{dialog}...</>
 */
export function useConfirm() {
  const [state, setState] = useState(null);

  const ask = useCallback(
    (opts) =>
      new Promise((resolve) => {
        setState({ ...opts, resolve });
      }),
    []
  );

  const close = useCallback(
    (value) => {
      setState((s) => {
        s?.resolve?.(value);
        return null;
      });
    },
    []
  );

  const dialog = (
    <ConfirmDialog
      open={Boolean(state)}
      title={state?.title}
      message={state?.message}
      detail={state?.detail}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      danger={state?.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { ask, dialog };
}
