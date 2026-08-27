/**
 * Salinan CommonJS dari lib/localAuth.js (versi Next.js pakai ESM).
 *
 * PENTING: format hash di kedua file HARUS identik. Kalau salah satu diubah
 * (N/r/p, panjang key, urutan field), password hasil /register tidak akan
 * cocok saat login di website. Bagian yang wajib sama:
 *
 *     scrypt$N$r$p$<salt_b64>$<hash_b64>
 */

const crypto = require("crypto");

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

const USERNAME_REGEX = /^[a-z0-9._-]{3,20}$/;

function normalizeUsername(raw) {
  return String(raw || "").trim().toLowerCase();
}

function validateUsername(raw) {
  const username = normalizeUsername(raw);

  if (!username) return { ok: false, error: "Username wajib diisi." };
  if (username.length < 3) return { ok: false, error: "Username minimal 3 karakter." };
  if (username.length > 20) return { ok: false, error: "Username maksimal 20 karakter." };
  if (!USERNAME_REGEX.test(username)) {
    return {
      ok: false,
      error: "Username hanya boleh huruf, angka, titik, underscore, dan minus. Tanpa spasi.",
    };
  }
  return { ok: true, username };
}

function validatePassword(raw) {
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

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
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

function verifyPassword(password, stored) {
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

  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  normalizeUsername,
  validateUsername,
  validatePassword,
  hashPassword,
  verifyPassword,
};
