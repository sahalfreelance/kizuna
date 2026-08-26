/**
 * Discord menonaktifkan Implicit Grant (response_type=token) untuk client
 * yang dibuat setelah kebijakan itu berlaku — jadi mobile app harus pakai
 * Authorization Code + PKCE, lalu tukar `code` jadi access_token di sini
 * (server-side, karena butuh DISCORD_CLIENT_SECRET yang gak boleh ada di app).
 *
 * PERUBAHAN: dulu fungsi ini cuma balikin `access_token` dan MEMBUANG
 * `refresh_token`. Akibatnya sesi mobile mati tiap ~7 hari (masa berlaku
 * access token Discord) dan user wajib login ulang. Sekarang seluruh
 * payload token dibalikin supaya app bisa menyimpan refresh_token dan
 * memperbarui sesinya sendiri tanpa login ulang.
 */

const TOKEN_ENDPOINT = "https://discord.com/api/oauth2/token";

/**
 * Tukar authorization code (PKCE) jadi token.
 * @returns {Promise<{access_token: string, refresh_token?: string, expires_in?: number, scope?: string}>}
 */
export async function exchangeCodeForToken(code, redirectUri, codeVerifier) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tukar kode Discord gagal (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Perbarui access token pakai refresh token.
 *
 * Discord memberi refresh token BARU setiap kali refresh berhasil, dan
 * yang lama langsung tidak berlaku (rotasi). Jadi pemanggil WAJIB
 * menyimpan `refresh_token` dari respons ini, bukan memakai yang lama.
 *
 * @returns {Promise<{access_token: string, refresh_token?: string, expires_in?: number}>}
 */
export async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Refresh token Discord gagal (${res.status}): ${text}`);
    // 400 = refresh token sudah tidak berlaku (dicabut / sudah dipakai).
    // Pemanggil pakai flag ini untuk memutuskan: minta login ulang, atau
    // sekadar coba lagi nanti.
    err.isInvalidGrant = res.status === 400;
    throw err;
  }

  return res.json();
}
