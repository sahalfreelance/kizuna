import { ethers } from "ethers";
import fetch from "node-fetch";
import "dotenv/config";

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY || "";

// PERUBAHAN dari versi CLI: dulu ini `throw` di top-level module. Di worker,
// throw saat import bikin seluruh proses mati dengan stack trace panjang
// sebelum pemeriksaan env lain sempat jalan. Sekarang dicek di dalam fungsi,
// jadi worker.js bisa melaporkan env yang kurang dengan pesan yang jelas.
function requireApiKey() {
  if (!OPENSEA_API_KEY) {
    throw new Error("OPENSEA_API_KEY belum di-set di aco-worker/.env");
  }
}

export const hasOpenseaApiKey = () => Boolean(OPENSEA_API_KEY);

const BASE_HEADERS = {
  "content-type": "application/json",
  "x-api-key": OPENSEA_API_KEY,
  "origin": "https://opensea.io",
  "referer": "https://opensea.io/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

async function getNonce(address) {
  const checksumAddress = ethers.getAddress(address);
  const res = await fetch("https://opensea.io/__api/auth/siwe/nonce", {
    method: "POST",
    headers: BASE_HEADERS,
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

async function verifySiwe(fields, signature) {
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
    headers: BASE_HEADERS,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`verifySiwe failed: ${res.status} ${text}`);

  let rawCookies = [];
  if (typeof res.headers.raw === "function") {
    rawCookies = res.headers.raw()["set-cookie"] || [];
  } else {
    const single = res.headers.get("set-cookie");
    if (single) rawCookies = [single];
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
    throw new Error("No access_token in response cookies — auth failed");
  }

  return cookieMap;
}

// onStatus callback: (status) => void
// status: 'nonce' | 'signed' | 'success' | 'error'
export async function siweLogin(privateKey, chainId = 1, onStatus = null) {
  requireApiKey();

  const wallet  = new ethers.Wallet(privateKey);
  const address = wallet.address;

  onStatus?.("nonce");
  const nonce = await getNonce(address);

  onStatus?.("signed");
  const { message, fields } = buildSiweMessage({ address, nonce, chainId });
  const signature = await wallet.signMessage(ethers.toUtf8Bytes(message));

  const cookies = await verifySiwe(fields, signature);

  onStatus?.("success");

  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}