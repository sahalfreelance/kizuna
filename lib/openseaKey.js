import { supabaseAdmin } from "./supabase";
import { encryptPrivateKey, decryptPrivateKey } from "./walletCrypto";

/**
 * Pengelola API key OpenSea.
 *
 * TEMUAN PENTING soal endpoint POST https://api.opensea.io/api/v2/auth/keys:
 * endpoint itu dibatasi **2 key per hari per IP**. Ini bukan dugaan — respons
 * aslinya:
 *
 *     429 { "errors": ["Key creation rate limit exceeded. Maximum 2 keys per day."] }
 *
 * Jadi "refresh key tiap user login" TIDAK BISA dijalankan apa adanya: 3 user
 * login di hari yang sama sudah menabrak limit, dan begitu kena limit kita
 * tidak bisa bikin key sama sekali sampai besok — termasuk saat benar-benar
 * dibutuhkan.
 *
 * Yang dilakukan di sini, dengan tujuan yang sama (tidak ada key basi):
 *
 *   1. Satu key dipakai bersama semua user, disimpan terenkripsi di DB.
 *   2. Tiap user login, key diperiksa. Kalau umurnya sudah lewat
 *      REFRESH_AFTER_DAYS (default 21 hari, sedangkan key berlaku 30 hari),
 *      baru diganti. Jadi key selalu punya sisa umur minimal ~9 hari.
 *   3. Ada jeda minimum antar pembuatan key (MIN_HOURS_BETWEEN_KEYS) supaya
 *      kuota 2/hari tidak pernah habis karena permintaan bertubrukan.
 *   4. Kalau pembuatan gagal, key lama TETAP dipakai selama belum kedaluwarsa.
 *      Lebih baik key tua yang masih jalan daripada tidak ada key sama sekali.
 */

const KEYS_ENDPOINT = "https://api.opensea.io/api/v2/auth/keys";

// Key OpenSea berlaku 30 hari. Diganti di hari ke-21 supaya selalu ada
// bantalan ~9 hari — kalau pembuatan gagal, masih banyak waktu untuk coba lagi.
const REFRESH_AFTER_DAYS = 21;
const ASSUMED_LIFETIME_DAYS = 30;

// Kuota 2 key/hari. Jeda 6 jam membuat maksimal 4 percobaan/hari secara teori,
// tapi dalam praktiknya refresh cuma terjadi sekali tiap 3 minggu.
const MIN_HOURS_BETWEEN_KEYS = 6;

function daysBetween(a, b) {
  return (b.getTime() - a.getTime()) / 86400000;
}

/** Minta key baru dari OpenSea. */
async function requestNewKey() {
  const res = await fetch(KEYS_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    cache: "no-store",
  });

  const text = await res.text();

  if (!res.ok) {
    // 429 = kuota harian habis. Ini kondisi yang diharapkan, bukan kerusakan.
    const isRateLimit = res.status === 429;
    throw Object.assign(
      new Error(
        isRateLimit
          ? "Kuota pembuatan API key OpenSea habis (2/hari). Pakai key yang ada."
          : `OpenSea membalas ${res.status}: ${text.slice(0, 200)}`
      ),
      { rateLimited: isRateLimit }
    );
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Respons OpenSea bukan JSON.");
  }

  // Nama field bisa berbeda-beda; ambil yang mana pun yang tersedia.
  const key =
    json.api_key || json.apiKey || json.key || json.token || json.data?.api_key;

  if (!key || typeof key !== "string") {
    throw new Error(
      `Tidak ada API key di respons OpenSea. Field yang ada: ${Object.keys(json).join(", ")}`
    );
  }

  const expiresAt =
    json.expires_at || json.expiresAt
      ? new Date(json.expires_at || json.expiresAt)
      : new Date(Date.now() + ASSUMED_LIFETIME_DAYS * 86400000);

  return { key, expiresAt };
}

/** Ambil baris key aktif dari DB (tanpa dekripsi). */
async function getActiveRow() {
  const { data, error } = await supabaseAdmin
    .from("opensea_api_keys")
    .select("id, encrypted_key, key_hint, created_at, expires_at")
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(`Query opensea_api_keys gagal: ${error.message}`);
  return data;
}

/** Simpan key baru dan nonaktifkan yang lama, dalam urutan yang aman. */
async function storeKey(key, expiresAt, reason) {
  // Nonaktifkan dulu yang lama: ada unique index yang cuma mengizinkan SATU
  // baris is_active = true, jadi insert akan ditolak kalau ini dilewat.
  await supabaseAdmin
    .from("opensea_api_keys")
    .update({ is_active: false, rotated_reason: reason })
    .eq("is_active", true);

  const { data, error } = await supabaseAdmin
    .from("opensea_api_keys")
    .insert({
      encrypted_key: encryptPrivateKey(key),
      key_hint: key.slice(-4),
      expires_at: expiresAt.toISOString(),
      is_active: true,
    })
    .select("id, key_hint, created_at, expires_at")
    .single();

  if (error) throw new Error(`Gagal simpan API key: ${error.message}`);
  return data;
}

/**
 * Dipanggil saat user login. Tidak melempar error — kegagalan di sini tidak
 * boleh menggagalkan login.
 *
 * Balikan: { action, reason } untuk dicatat di log server.
 */
export async function ensureFreshOpenseaKey() {
  try {
    const row = await getActiveRow();
    const now = new Date();

    // Belum ada key sama sekali.
    if (!row) {
      const { key, expiresAt } = await requestNewKey();
      await storeKey(key, expiresAt, "belum ada key");
      return { action: "created", reason: "belum ada key aktif" };
    }

    const createdAt = new Date(row.created_at);
    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
    const ageDays = daysBetween(createdAt, now);
    const expired = expiresAt && expiresAt <= now;

    if (!expired && ageDays < REFRESH_AFTER_DAYS) {
      return {
        action: "kept",
        reason: `key masih segar (umur ${ageDays.toFixed(1)} hari)`,
      };
    }

    // Jangan minta key baru terlalu sering — kuota cuma 2/hari.
    const hoursSinceLast = (now - createdAt) / 3600000;
    if (hoursSinceLast < MIN_HOURS_BETWEEN_KEYS) {
      return {
        action: "skipped",
        reason: `baru ${hoursSinceLast.toFixed(1)} jam sejak key terakhir`,
      };
    }

    try {
      const { key, expiresAt: newExpiry } = await requestNewKey();
      await storeKey(key, newExpiry, expired ? "kedaluwarsa" : `umur ${ageDays.toFixed(0)} hari`);
      return { action: "rotated", reason: expired ? "key kedaluwarsa" : "key sudah tua" };
    } catch (err) {
      // Kunci keputusan: kalau gagal bikin key baru, JANGAN buang yang lama.
      if (!expired) {
        return { action: "kept", reason: `refresh gagal (${err.message}), pakai key lama` };
      }
      return { action: "failed", reason: err.message };
    }
  } catch (err) {
    console.error("[openseaKey] error:", err?.message ?? err);
    return { action: "error", reason: String(err?.message ?? err) };
  }
}

/**
 * Ambil API key yang siap pakai (sudah didekripsi).
 * Dipakai worker lewat endpoint internal, bukan langsung dari browser.
 */
export async function getOpenseaApiKey() {
  const row = await getActiveRow();
  if (!row) return null;

  if (row.expires_at && new Date(row.expires_at) <= new Date()) return null;

  // Catat pemakaian; kegagalan update ini tidak penting.
  supabaseAdmin
    .from("opensea_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => {}, () => {});

  return decryptPrivateKey(row.encrypted_key);
}

/** Status untuk ditampilkan (tanpa membocorkan key). */
export async function getOpenseaKeyStatus() {
  const row = await getActiveRow();
  if (!row) return { present: false };

  const now = new Date();
  const createdAt = new Date(row.created_at);
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;

  return {
    present: true,
    hint: row.key_hint,
    ageDays: Number(daysBetween(createdAt, now).toFixed(1)),
    expiresAt: expiresAt?.toISOString() ?? null,
    daysLeft: expiresAt ? Number(daysBetween(now, expiresAt).toFixed(1)) : null,
    expired: expiresAt ? expiresAt <= now : false,
  };
}
