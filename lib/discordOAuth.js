/**
 * Discord menonaktifkan Implicit Grant (response_type=token) untuk client
 * yang dibuat setelah kebijakan itu berlaku — jadi mobile app harus pakai
 * Authorization Code + PKCE, lalu tukar `code` jadi access_token di sini
 * (server-side, karena butuh DISCORD_CLIENT_SECRET yang gak boleh ada di app).
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

  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tukar kode Discord gagal (${res.status}): ${text}`);
  }

  const data = await res.json();
  return data.access_token;
}
