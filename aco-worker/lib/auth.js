import { ethers } from "ethers";
// limitedFetch: login SIWE banyak wallet berbarengan gampang kena 429 di
// opensea.io. Rate limiter memberi jeda otomatis, bukan menggagalkan.
import { limitedFetch as fetch } from "./rateLimiter.js";
import "dotenv/config";

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || "";

// PERUBAHAN dari versi CLI: API key tidak lagi dibaca dari env saja.
// Sekarang bisa dikirim sebagai argumen (dari lib/openseaKey.js yang mengambil
// key terkelola dari website), dengan env sebagai cadangan. Alasannya: key
// OpenSea kedaluwarsa 30 hari dan dirotasi otomatis, jadi menuliskannya di
// .env berarti harus diedit manual tiap kali rotasi.
//
// Pemeriksaan juga dipindah dari top-level ke dalam fungsi — throw saat import
// mematikan proses dengan stack trace sebelum worker bisa melaporkan env mana
// yang kurang.
function resolveApiKey(apiKey) {
  const key = apiKey || OPENSEA_API_KEY;
  if (!key) {
    throw new Error(
      "API key OpenSea tidak tersedia. Cek WEBSITE_URL + WORKER_SHARED_SECRET, " +
        "atau isi OPENSEA_API_KEY di aco-worker/.env"
    );
  }
  return key;
}

export const hasOpenseaApiKey = () => Boolean(OPENSEA_API_KEY);

function buildHeaders(apiKey) {
  return { ...BASE_HEADERS, "x-api-key": resolveApiKey(apiKey) };
}

const BASE_HEADERS = {
  "content-type": "application/json",
  "origin": "https://opensea.io",
  "referer": "https://opensea.io/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

async function getNonce(address, apiKey) {
  const checksumAddress = ethers.getAddress(address);
  const res = await fetch("https://opensea.io/__api/auth/siwe/nonce", {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify({ address: checksumAddress }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`getNonce failed: ${res.status} ${text}`);
  const data = JSON.parse(text);
  return data.nonce;
}

function buildSiweMessage({ address, nonce, chainId }) {
  const issuedAt = new Date().toISOString();
  const fields = {
    domain: "opensea.io",
    address: ethers.getAddress(address),
    statement: "Click to sign in and accept the OpenSea Terms of Service (https://opensea.io/tos) and Privacy Policy (https://opensea.io/privacy).",
    uri: "https://opensea.io/",
    version: "1",
    chainId: String(chainId),
    nonce,
    issuedAt,
  };
  const message = [
    `${fields.domain} wants you to sign in with your account:`,
    fields.address,
    ``,
    fields.statement,
    ``,
    `URI: ${fields.uri}`,
    `Version: ${fields.version}`,
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
  ].join("\n");
  return { message, fields };
}

async function verifySiwe(fields, signature, apiKey) {
  const body = {
    message: {
      domain: fields.domain,
      address: ethers.getAddress(fields.address),
      statement: fields.statement,
      uri: fields.uri,
      version: fields.version,
      chainId: String(fields.chainId),
      nonce: fields.nonce,
      issuedAt: fields.issuedAt,
    },
    signature,
    chainArch: "EVM",
    connectorId: "injected",
  };
  const res = await fetch("https://opensea.io/__api/auth/siwe/verify", {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`verifySiwe failed: ${res.status} ${text}`);

  // PENTING — sumber bug yang bikin "No access_token in response cookies":
  //
  // Versi CLI pakai node-fetch, yang punya `res.headers.raw()`. Setelah
  // node-fetch diganti fetch bawaan Node (undici) lewat limitedFetch, method
  // itu TIDAK ADA lagi, jadi kode jatuh ke `headers.get("set-cookie")`.
  //
  // Masalahnya: OpenSea mengirim BEBERAPA header Set-Cookie (access_token,
  // refresh_token, auth_hint, ...). `headers.get()` menggabungkannya jadi satu
  // string dipisah ", " — dan parser di bawah cuma mengambil pasangan pertama
  // (`__cf_bm`), sehingga access_token tidak pernah terbaca dan login selalu
  // dianggap gagal padahal server membalas 200.
  //
  // Perbaikannya: pakai `getSetCookie()` (standar WHATWG, ada di undici) yang
  // mengembalikan ARRAY berisi tiap header Set-Cookie secara terpisah.
  let rawCookies = [];
  if (typeof res.headers.getSetCookie === "function") {
    rawCookies = res.headers.getSetCookie();
  } else if (typeof res.headers.raw === "function") {
    // node-fetch (kalau suatu saat dipakai lagi)
    rawCookies = res.headers.raw()["set-cookie"] || [];
  } else {
    // Cadangan terakhir: pisah manual. Tidak bisa asal split(",") karena
    // atribut Expires mengandung koma ("Expires=Fri, 28 Aug 2026 ..."), jadi
    // dipisah hanya di koma yang diikuti "nama=".
    const single = res.headers.get("set-cookie");
    if (single) rawCookies = single.split(/,\s*(?=[^=;,\s]+=)/);
  }

  const cookieMap = {};
  for (const cookie of rawCookies) {
    const [pair] = cookie.split(";");
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const val = pair.slice(eqIdx + 1).trim();
    if (key && val) cookieMap[key] = val;
  }

  if (!cookieMap["access_token"]) {
    throw new Error(
      "No access_token in response cookies — auth failed. " +
        `Cookie yang terbaca: ${Object.keys(cookieMap).join(", ") || "(tidak ada)"}`
    );
  }

  return cookieMap;
}

// onStatus callback: (status) => void
// status: 'nonce' | 'signed' | 'success' | 'error'
//
// apiKey: kalau diisi, dipakai menggantikan OPENSEA_API_KEY dari env. Worker
// mengisinya dengan key terkelola dari website (lihat lib/openseaKey.js).
export async function siweLogin(privateKey, chainId = 1, onStatus = null, apiKey = null) {
  const wallet  = new ethers.Wallet(privateKey);
  const address = wallet.address;

  onStatus?.("nonce");
  const nonce = await getNonce(address, apiKey);

  onStatus?.("signed");
  const { message, fields } = buildSiweMessage({ address, nonce, chainId });
  const signature = await wallet.signMessage(ethers.toUtf8Bytes(message));

  const cookies = await verifySiwe(fields, signature, apiKey);

  onStatus?.("success");

  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}