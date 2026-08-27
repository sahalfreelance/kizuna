"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const DEVICE_KEY = "kizuna_device_id";

/**
 * Device ID untuk web: UUID acak yang disimpan di localStorage.
 *
 * Ini BUKAN identitas yang bisa dipercaya (user bisa menghapusnya, dan bikin
 * device_id baru), tapi memang bukan itu fungsinya — server-lah yang menegakkan
 * aturan 1 user 1 device lewat kolom device_id + UNIQUE index. Yang ini cuma
 * penanda "browser yang sama".
 *
 * Konsekuensi yang perlu diketahui: hapus localStorage / ganti browser =
 * dianggap perangkat baru, jadi user harus /reset-device di bot Discord.
 */
function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    // localStorage diblokir (mode privat / cookie ditolak). Balikin null,
    // biar user dapat pesan yang jelas alih-alih error misterius.
    return null;
  }
}

function deviceLabel() {
  const ua = navigator.userAgent || "";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\//.test(ua) ? "Opera" :
    /Chrome\//.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) ? "Safari" : "Browser";
  const os =
    /Windows/.test(ua) ? "Windows" :
    /Android/.test(ua) ? "Android" :
    /iPhone|iPad/.test(ua) ? "iOS" :
    /Mac OS X/.test(ua) ? "macOS" :
    /Linux/.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ");
}

export default function LoginForm({ callbackUrl = "/" }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [deviceReady, setDeviceReady] = useState(true);

  useEffect(() => {
    setDeviceReady(getDeviceId() !== null);
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;

    setError(null);
    setErrorCode(null);

    const deviceId = getDeviceId();
    if (!deviceId) {
      setError(
        "Browser ini memblokir penyimpanan lokal. Matikan mode privat atau izinkan cookie, lalu coba lagi."
      );
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          device_id: deviceId,
          device_label: deviceLabel(),
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json.error || "Login gagal. Coba lagi.");
        setErrorCode(json.code || null);
        return;
      }

      // Cookie httpOnly sudah di-set server. refresh() supaya server component
      // membaca cookie baru itu, lalu pindah halaman.
      router.refresh();
      router.replace(callbackUrl || "/");
    } catch {
      setError("Tidak bisa menghubungi server. Cek koneksi kamu.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    width: "100%",
    background: "var(--bg2)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "9px 11px",
    fontSize: 13,
    color: "var(--text)",
    fontFamily: "var(--font-mono)",
    outline: "none",
  };

  const labelStyle = {
    display: "block",
    fontSize: 10.5,
    letterSpacing: 1,
    color: "var(--text-dim)",
    marginBottom: 5,
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label htmlFor="username" style={labelStyle}>USERNAME</label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={busy}
          style={inputStyle}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--indigo)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
        />
      </div>

      <div>
        <label htmlFor="password" style={labelStyle}>PASSWORD</label>
        <div style={{ position: "relative" }}>
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            style={{ ...inputStyle, paddingRight: 54 }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--indigo)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              color: "var(--text-dim)",
              fontSize: 10,
              letterSpacing: 0.5,
              cursor: "pointer",
              padding: 4,
              fontFamily: "var(--font-mono)",
            }}
          >
            {showPassword ? "HIDE" : "SHOW"}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            fontSize: 11.5,
            color: "#f87171",
            background: "rgba(248,113,113,0.07)",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 4,
            padding: "9px 11px",
            lineHeight: 1.6,
          }}
        >
          {error}
          {errorCode === "DEVICE_MISMATCH" && (
            <div style={{ marginTop: 7, color: "var(--text-mid)", fontSize: 11 }}>
              Buka Discord, jalankan <code style={{ color: "var(--indigo-dim)" }}>/reset-device</code>,
              lalu login lagi di sini.
            </div>
          )}
          {errorCode === "DEVICE_TAKEN" && (
            <div style={{ marginTop: 7, color: "var(--text-mid)", fontSize: 11 }}>
              Perangkat ini masih terikat ke akun lain. Akun tersebut harus
              menjalankan <code style={{ color: "var(--indigo-dim)" }}>/reset-device</code> dulu.
            </div>
          )}
        </div>
      )}

      {!deviceReady && (
        <div style={{ fontSize: 11, color: "var(--live)", lineHeight: 1.6 }}>
          Penyimpanan lokal browser diblokir — login butuh ini untuk menandai perangkat.
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !username || !password}
        style={{
          marginTop: 4,
          width: "100%",
          background: busy ? "var(--indigo-mute)" : "var(--indigo)",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          padding: "10px 14px",
          fontSize: 12.5,
          fontWeight: 700,
          letterSpacing: 1,
          cursor: busy || !username || !password ? "not-allowed" : "pointer",
          opacity: !username || !password ? 0.55 : 1,
          fontFamily: "var(--font-mono)",
          transition: "background 0.15s, opacity 0.15s",
        }}
      >
        {busy ? "AUTHENTICATING…" : "./login.sh →"}
      </button>

      <p
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          lineHeight: 1.7,
          marginTop: 6,
          paddingTop: 14,
          borderTop: "1px solid var(--border)",
        }}
      >
        Belum punya akun? Buka Discord House of Kizuna, jalankan{" "}
        <code style={{ color: "var(--indigo-dim)" }}>/register</code> di channel
        yang disediakan.
        <br />
        Lupa password atau ganti HP? Pakai{" "}
        <code style={{ color: "var(--indigo-dim)" }}>/reset-device</code> atau{" "}
        <code style={{ color: "var(--indigo-dim)" }}>/change-password</code>.
      </p>
    </form>
  );
}
