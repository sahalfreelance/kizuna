import crypto from "crypto";

/**
 * Autentikasi lokal: username + password, akun dibuat lewat bot Discord.
 *
 * Kenapa bukan bcrypt? Supaya tidak menambah dependency native yang harus
 * di-compile — `crypto.scrypt` sudah ada di Node. scrypt memory-hard, jadi
 * lebih tahan serangan GPU dibanding PBKDF2 dengan biaya setara.
 *
 * File ini dipakai DUA tempat: Next.js (web/API) dan bot Discord. Bot punya
 * salinannya sendiri di bot/lib/localAuth.js — kalau format hash diubah di
 * sini, ubah juga di sana, kalau tidak password hasil /register nggak akan
 * cocok saat login.
 */

// N=16384 (2^14) -> sekitar 16 MB memori per hash, ~50-80ms di Vercel.
// Cukup kuat tanpa bikin login lambat atau kena batas waktu serverless.
const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

// Sengaja dibatasi: lowercase, angka, underscore, titik, minus. Tanpa spasi
// dan tanpa karakter yang bisa dikira lain (biar nggak ada username kembar
// secara visual).
const USERNAME_REGEX = /^[a-z0-9._-]{3,20}$/;

export function normalizeUsername(raw) {
  return String(raw || "").trim().toLowerCase();
}

export function validateUsername(raw) {
  const username = normalizeUsername(raw);

  if (!username) return { ok: false, error: "Username wajib diisi." };
  if (username.length < 3) return { ok: false, error: "Username minimal 3 karakter." };
  if (username.length > 20) return { ok: false, error: "Username maksimal 20 karakter." };
  if (!USERNAME_REGEX.test(username)) {
    return {
      ok: false,
      error: "Username hanya boleh huruf, angka, titik, underscore, dan minus.",
    };
  }
  return { ok: true, username };
}

export function validatePassword(raw) {
  const password = String(raw || "");

  if (!password) return { ok: false, error: "Password wajib diisi." };
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password minimal ${MIN_PASSWORD_LENGTH} karakter.` };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, error: `Password maksimal ${MAX_PASSWORD_LENGTH} karakter.` };
  }
  return { ok: true, password };
}

/** Hasil: scrypt$N$r$p$<salt_b64>$<hash_b64> */
export function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    // scrypt butuh maxmem >= 128*N*r; default Node 32MB kurang untuk N=16384.
    maxmem: 64 * 1024 * 1024,
  });

  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_r,
    SCRYPT_p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

export function verifyPassword(password, stored) {
  if (!password || !stored) return false;

  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = parseInt(nStr, 10);
  const r = parseInt(rStr, 10);
  const p = parseInt(pStr, 10);
  if (!N || !r || !p) return false;

  let expected;
  let actual;
  try {
    expected = Buffer.from(hashB64, "base64");
    actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    return false;
  }

  // timingSafeEqual melempar kalau panjang beda, jadi dicek dulu.
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/* ------------------------------------------------------------------ token */

/**
 * Token sesi: <payload_b64url>.<signature_b64url>
 *
 * Stateless dan ditandatangani HMAC-SHA256, jadi middleware bisa
 * memverifikasinya di Edge tanpa query database sama sekali.
 *
 * `sv` (session_version) ikut di payload. Kalau nilainya beda dengan yang di
 * database, token ditolak — ini cara logout paksa (ganti password / reset
 * device) tanpa perlu menyimpan daftar token aktif.
 *
 * `did` (device_id) juga ikut, supaya token yang dicuri tidak bisa dipakai
 * dari perangkat lain.
 */

const TOKEN_VERSION = 1;
export const SESSION_COOKIE = "kizuna_session";
export const DEFAULT_TTL_DAYS = 30;

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function getSecret() {
  const secret = process.env.AUTH_SESSION_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SESSION_SECRET (atau NEXTAUTH_SECRET) belum di-set — token sesi tidak bisa dibuat."
    );
  }
  return secret;
}

function sign(data, secret) {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

export function createSessionToken(
  { userId, username, deviceId, sessionVersion, isAdmin },
  { ttlDays = DEFAULT_TTL_DAYS } = {}
) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: TOKEN_VERSION,
    uid: userId,
    u: username,
    did: deviceId,
    sv: sessionVersion,
    adm: isAdmin ? 1 : 0,
    iat: now,
    exp: now + ttlDays * 86400,
  };

  const body = b64url(JSON.stringify(payload));
  const sig = b64url(sign(body, getSecret()));
  return `${body}.${sig}`;
}

/**
 * Verifikasi tanda tangan + kedaluwarsa. TIDAK menyentuh database, jadi aman
 * dipakai di Edge middleware. Pengecekan session_version terhadap DB
 * dilakukan terpisah di lib/apiAuth.js.
 */
export function verifySessionToken(token) {
  if (!token || typeof token !== "string") {
    return { ok: false, reason: "NO_TOKEN" };
  }

  const dot = token.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "MALFORMED" };

  const body = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let expectedSig;
  let actualSig;
  try {
    expectedSig = sign(body, getSecret());
    actualSig = Buffer.from(sigPart, "base64url");
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }

  if (expectedSig.length !== actualSig.length) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }
  if (!crypto.timingSafeEqual(expectedSig, actualSig)) {
    return { ok: false, reason: "BAD_SIGNATURE" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "MALFORMED" };
  }

  if (payload.v !== TOKEN_VERSION) return { ok: false, reason: "VERSION" };
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "EXPIRED" };
  }

  return { ok: true, payload };
}

/* ----------------------------------------------------------------- device */

/**
 * Device ID datang dari klien, jadi TIDAK bisa dipercaya sebagai identitas —
 * fungsinya cuma menandai "perangkat yang sama". Yang menegakkan aturan
 * 1-user-1-device tetap server (kolom device_id + UNIQUE index di DB).
 *
 * Android: pakai nilai yang stabil per instalasi, misal
 * `Settings.Secure.ANDROID_ID` atau UUID yang disimpan di EncryptedSharedPreferences.
 * Web: UUID di localStorage.
 */
export function normalizeDeviceId(raw) {
  const id = String(raw || "").trim();
  if (id.length < 8 || id.length > 200) return null;
  // Hanya karakter aman supaya tidak ada yang aneh masuk ke DB/log.
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) return null;
  return id;
}
