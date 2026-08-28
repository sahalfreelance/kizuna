import crypto from "crypto";

/**
 * Salinan ESM dari lib/walletCrypto.js (versi website).
 *
 * PENTING: format enkripsi di kedua file HARUS identik, kalau tidak wallet
 * yang diimpor lewat website tidak bisa didekripsi di worker.
 *
 *     v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
 *
 * WALLET_ENCRYPTION_KEY di worker WAJIB sama persis dengan yang di Vercel.
 */

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32;

function getKey() {
  const raw = process.env.WALLET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "WALLET_ENCRYPTION_KEY belum di-set. Nilainya harus SAMA dengan yang di Vercel."
    );
  }

  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (key.length !== KEY_LEN) {
    throw new Error(
      `WALLET_ENCRYPTION_KEY harus 32 byte, dapat ${key.length} byte. ` +
        "Bikin dengan: openssl rand -base64 32"
    );
  }
  return key;
}

export function assertEncryptionKeyReady() {
  getKey();
  return true;
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

  const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "Gagal dekripsi wallet. WALLET_ENCRYPTION_KEY di worker kemungkinan " +
        "BEDA dengan yang dipakai website saat import."
    );
  }
}

export function maskAddress(address) {
  const s = String(address || "");
  return s.length < 12 ? s : `${s.slice(0, 6)}…${s.slice(-4)}`;
}
