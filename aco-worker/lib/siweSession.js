import { supabase } from "./supabase.js";
import { encryptPrivateKey, decryptPrivateKey } from "./walletCrypto.js";
import { siweLogin } from "./auth.js";

/**
 * Cache session SIWE per wallet.
 *
 * Login SIWE butuh ~2 detik per wallet dan menembak opensea.io 2x (nonce +
 * verify). Kalau tiap pengecekan login ulang, checker jadi lambat dan gampang
 * kena rate limit. Cookie disimpan terenkripsi di DB dan dipakai ulang.
 *
 * Cookie berisi access_token JWT — setara sesi login penuh, jadi dienkripsi
 * dengan kunci yang sama seperti private key, bukan disimpan plaintext.
 */

// access_token OpenSea berumur relatif pendek. 20 menit dipilih konservatif:
// cukup lama untuk menghemat login berulang, cukup pendek supaya tidak dipakai
// saat sudah kedaluwarsa di tengah pengecekan.
const SESSION_TTL_MS = 20 * 60 * 1000;

// Cache di memori proses, di atas cache DB. Menghindari round-trip DB untuk
// pengecekan yang berurutan cepat.
const memCache = new Map(); // walletId -> { cookieStr, expiresAt }

export async function getSiweSession(
  { walletId, address, privateKey, chainId = 1, apiKey = null },
  { forceRelogin = false, log = null } = {}
) {
  const now = Date.now();

  if (!forceRelogin) {
    const mem = memCache.get(walletId);
    if (mem && mem.expiresAt > now + 30000) {
      return mem.cookieStr;
    }

    // Coba dari DB — worker bisa restart tanpa kehilangan session.
    try {
      const { data } = await supabase
        .from("aco_siwe_sessions")
        .select("encrypted_cookies, expires_at")
        .eq("wallet_id", walletId)
        .maybeSingle();

      if (data && new Date(data.expires_at).getTime() > now + 30000) {
        const cookieStr = decryptPrivateKey(data.encrypted_cookies);
        memCache.set(walletId, {
          cookieStr,
          expiresAt: new Date(data.expires_at).getTime(),
        });
        return cookieStr;
      }
    } catch (err) {
      // Cache rusak bukan alasan gagal — login ulang saja.
      await log?.warn?.(`Cache session tidak terpakai: ${err.message}`);
    }
  }

  // Login baru.
  const cookieStr = await siweLogin(privateKey, chainId, null, apiKey);
  const expiresAt = new Date(now + SESSION_TTL_MS);

  memCache.set(walletId, { cookieStr, expiresAt: expiresAt.getTime() });

  // Simpan ke DB; kegagalan di sini tidak menggagalkan pengecekan.
  try {
    await supabase.from("aco_siwe_sessions").upsert(
      {
        wallet_id: walletId,
        address,
        encrypted_cookies: encryptPrivateKey(cookieStr),
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: "wallet_id" }
    );
  } catch (err) {
    await log?.warn?.(`Gagal simpan cache session: ${err.message}`);
  }

  return cookieStr;
}

/** Buang session yang ditolak OpenSea supaya percobaan berikutnya login ulang. */
export async function invalidateSiweSession(walletId) {
  memCache.delete(walletId);
  try {
    await supabase.from("aco_siwe_sessions").delete().eq("wallet_id", walletId);
  } catch {
    /* abaikan */
  }
}
