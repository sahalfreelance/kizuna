/**
 * Verifikasi token sesi versi Edge-compatible.
 *
 * PENTING: `middleware.js` jalan di Edge runtime, dan di sana `node:crypto`
 * TIDAK tersedia — `crypto.createHmac` bakal error saat build/deploy Vercel.
 * Jadi file ini memakai Web Crypto (`crypto.subtle`) yang ada di Edge maupun
 * Node 18+.
 *
 * Formatnya harus identik dengan `createSessionToken` di lib/localAuth.js:
 *     <payload_b64url>.<hmac_sha256_b64url>
 */

const TOKEN_VERSION = 1;
export const SESSION_COOKIE = "kizuna_session";

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function getSecret() {
  return process.env.AUTH_SESSION_SECRET || process.env.NEXTAUTH_SECRET || "";
}

/** Bandingkan byte-per-byte tanpa early return, biar tidak bocor lewat waktu. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifySessionTokenEdge(token) {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "NO_TOKEN" };
  }

  const secret = getSecret();
  if (!secret) return { ok: false, reason: "NO_SECRET" };

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "MALFORMED" };

  const body = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let key;
  let expected;
  let actual;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    expected = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
    );
    actual = b64urlToBytes(sigPart);
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }

  if (!timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }

  if (payload.v !== TOKEN_VERSION) return { ok: false, reason: "VERSION" };
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "EXPIRED" };
  }

  return { ok: true, payload };
}
