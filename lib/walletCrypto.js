import crypto from "crypto";

/**
 * Enkripsi private key wallet sebelum masuk database.
 *
 * AES-256-GCM: memberi kerahasiaan DAN integritas sekaligus. Kalau ciphertext
 * di database diubah orang (walau cuma 1 bit), dekripsi akan GAGAL, bukan
 * menghasilkan sampah yang diam-diam dipakai sebagai private key.
 *
 * Kunci ada di env WALLET_ENCRYPTION_KEY, TIDAK di database. Jadi dump
 * database saja tidak cukup untuk mencuri wallet — penyerang butuh keduanya.
 *
 * KALAU WALLET_ENCRYPTION_KEY HILANG, SEMUA WALLET TERSIMPAN JADI SAMPAH.
 * Tidak ada recovery. Simpan cadangannya di tempat aman (password manager).
 *
 * Format hasil: v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 * Prefix versi supaya nanti bisa ganti algoritma tanpa merusak data lama.
 */

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;   // 96 bit, ukuran yang direkomendasikan untuk GCM
const KEY_LEN = 32;  // AES-256

function getKey() {
  const raw = process.env.WALLET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "WALLET_ENCRYPTION_KEY belum di-set. Bikin dengan: openssl rand -base64 32"
    );
  }

  // Terima base64 (hasil `openssl rand -base64 32`) atau hex 64 karakter.
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    key = Buffer.from(raw, "hex");
  } else {
    key = Buffer.from(raw, "base64");
  }

  if (key.length !== KEY_LEN) {
    throw new Error(
      `WALLET_ENCRYPTION_KEY harus 32 byte (${KEY_LEN * 8} bit), dapat ${key.length} byte. ` +
        "Bikin yang benar dengan: openssl rand -base64 32"
    );
  }
  return key;
}

/** Cek kunci sudah benar tanpa membocorkan nilainya. Dipakai saat startup. */
export function assertEncryptionKeyReady() {
  getKey();
  return true;
}

export function encryptPrivateKey(plaintext) {
  if (!plaintext || typeof plaintext !== "string") {
    throw new Error("Private key kosong.");
  }

  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptPrivateKey(stored) {
  if (!stored || typeof stored !== "string") {
    throw new Error("Data terenkripsi kosong.");
  }

  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Format data terenkripsi tidak dikenal.");
  }

  const [, ivB64, tagB64, dataB64] = parts;
  const key = getKey();

  const decipher = crypto.createDecipheriv(
    ALGO,
    key,
    Buffer.from(ivB64, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // authTag tidak cocok -> data diubah, ATAU kunci enkripsinya beda.
    throw new Error(
      "Gagal dekripsi wallet. Kemungkinan WALLET_ENCRYPTION_KEY berbeda dengan " +
        "yang dipakai saat import, atau data di database berubah."
    );
  }
}

/* --------------------------------------------------------- validasi input */

/**
 * Normalisasi private key: terima dengan atau tanpa prefix 0x, hasilnya
 * selalu pakai 0x. Balikin null kalau bukan private key EVM yang valid.
 */
export function normalizePrivateKey(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  const hex = s.startsWith("0x") || s.startsWith("0X") ? s.slice(2) : s;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;

  // Private key 0 tidak valid di secp256k1.
  if (/^0+$/.test(hex)) return null;

  return "0x" + hex.toLowerCase();
}

/** Untuk ditampilkan di UI/log: 0x1234…abcd */
export function maskAddress(address) {
  const s = String(address || "");
  if (s.length < 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
