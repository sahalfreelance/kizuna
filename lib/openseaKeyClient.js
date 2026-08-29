"use client";

/**
 * Ambil API key OpenSea DARI BROWSER USER, lalu simpan ke server.
 *
 * Kenapa dari browser dan bukan dari server:
 *
 *   Pembuatan key dibatasi 2 per hari PER IP. Kalau server yang meminta,
 *   semua user berbagi kuota IP server — habis setelah 2 user dan sisanya
 *   gagal. Dengan memanggil dari browser, kuota terpakai dari IP user
 *   masing-masing.
 *
 *   Terverifikasi: OPTIONS ke /api/v2/auth/keys membalas
 *   `access-control-allow-origin` yang memantulkan origin apa pun, jadi fetch
 *   lintas-origin dari browser diizinkan OpenSea.
 *
 * Key yang didapat langsung dikirim ke /api/aco/user-key untuk dienkripsi dan
 * disimpan. Key TIDAK disimpan di localStorage — kalau disimpan di sana, XSS
 * apa pun di halaman bisa mencurinya.
 */

const KEYS_ENDPOINT = "https://api.opensea.io/api/v2/auth/keys";

// Penanda di sessionStorage supaya tidak mencoba berkali-kali dalam satu sesi
// browser. Kuota cuma 2/hari, jadi percobaan berulang harus dihindari.
const ATTEMPT_FLAG = "kizuna_oskey_attempted";

/** Minta key baru dari OpenSea (dijalankan di browser user). */
async function requestKeyFromOpensea() {
  const res = await fetch(KEYS_ENDPOINT, {
    method: "POST",
    headers: { accept: "application/json" },
  });

  const text = await res.text();

  if (!res.ok) {
    if (res.status === 429) {
      throw Object.assign(
        new Error("Kuota pembuatan API key OpenSea habis (2 per hari). Coba lagi besok."),
        { rateLimited: true }
      );
    }
    throw new Error(`OpenSea membalas ${res.status}: ${text.slice(0, 150)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Respons OpenSea bukan JSON.");
  }

  // Nama field bisa berbeda; ambil yang mana pun tersedia.
  const key =
    json.api_key || json.apiKey || json.key || json.token || json.data?.api_key;

  if (!key || typeof key !== "string") {
    throw new Error(
      `Tidak ada API key di respons. Field yang ada: ${Object.keys(json).join(", ")}`
    );
  }

  return { key, expiresAt: json.expires_at || json.expiresAt || null };
}

async function saveToServer(key, expiresAt) {
  const res = await fetch("/api/aco/user-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, expires_at: expiresAt }),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || "Gagal simpan key ke server.");
  }
  return res.json();
}

/**
 * Periksa status key user, dan perbarui kalau perlu.
 *
 * Balikan: { action, reason, hint? }
 *   action: 'kept' | 'created' | 'refreshed' | 'rate_limited' | 'failed'
 *
 * Tidak melempar error — pemanggil cukup menampilkan hasilnya.
 */
export async function ensureUserOpenseaKey({ force = false } = {}) {
  try {
    const statusRes = await fetch("/api/aco/user-key", { cache: "no-store" });
    if (!statusRes.ok) {
      return { action: "failed", reason: "tidak bisa cek status key" };
    }

    const { data: status } = await statusRes.json();

    if (!force && status.present && !status.needsRefresh) {
      return { action: "kept", reason: status.reason, hint: status.hint };
    }

    // Sudah pernah dicoba di sesi browser ini dan gagal — jangan buang kuota.
    if (!force && sessionStorage.getItem(ATTEMPT_FLAG) === "1") {
      return {
        action: status.present ? "kept" : "failed",
        reason: status.present
          ? "pakai key lama, refresh sudah dicoba di sesi ini"
          : "pembuatan key sudah dicoba di sesi ini",
        hint: status.hint,
      };
    }

    try {
      sessionStorage.setItem(ATTEMPT_FLAG, "1");
    } catch {
      /* sessionStorage diblokir — lanjut saja */
    }

    let result;
    try {
      result = await requestKeyFromOpensea();
    } catch (err) {
      // Kalau masih ada key lama yang belum kedaluwarsa, itu tetap dipakai.
      // Lebih baik key tua yang jalan daripada tidak ada key sama sekali.
      if (status.present && !status.expired) {
        return {
          action: "kept",
          reason: `refresh gagal (${err.message}), pakai key lama`,
          hint: status.hint,
        };
      }
      return {
        action: err.rateLimited ? "rate_limited" : "failed",
        reason: err.message,
      };
    }

    await saveToServer(result.key, result.expiresAt);

    return {
      action: status.present ? "refreshed" : "created",
      reason: status.present ? "key diperbarui" : "key baru dibuat",
      hint: result.key.slice(-4),
    };
  } catch (err) {
    return { action: "failed", reason: String(err?.message ?? err) };
  }
}

/** Dipanggil saat user menekan tombol refresh manual di /aco. */
export function forceRefreshUserKey() {
  try {
    sessionStorage.removeItem(ATTEMPT_FLAG);
  } catch {
    /* abaikan */
  }
  return ensureUserOpenseaKey({ force: true });
}
