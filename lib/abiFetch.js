/**
 * Ambil ABI kontrak otomatis, tanpa user menempel apa pun.
 *
 * Tiga jalur, dicoba berurutan:
 *
 *   1. Blockscout `/api/v2/smart-contracts/<addr>` — gratis, tanpa API key.
 *      Ini jalur utama untuk chain kecil (Robinhood, Zora, Soneium) yang tidak
 *      ada di Etherscan.
 *   2. Etherscan V2 `?chainid=<id>` — satu API key untuk 60+ chain. Hanya
 *      dipakai kalau ETHERSCAN_API_KEY diisi; tanpa key balasannya
 *      "Missing/Invalid API Key" (terverifikasi).
 *   3. Fallback bytecode: kontrak TIDAK verified tetap bisa dipakai. Selector
 *      diekstrak dari bytecode (PUSH4), namanya dicari di 4byte.directory.
 *      Hasilnya ABI parsial — cukup untuk memanggil fungsi mint.
 *
 * Jalur 3 itu yang bikin fitur ini jalan di kontrak baru: kontrak mint yang
 * belum diverifikasi adalah hal normal saat drop baru live.
 */

import { keccak256, toUtf8Bytes } from "ethers";
import { getChain } from "./chains.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const TIMEOUT_MS = 15000;

function isAddress(a) {
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
}

async function getJson(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json", ...extraHeaders },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, json: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, json: null };
  }
}

/* ------------------------------------------------------ 1. BLOCKSCOUT */

async function fromBlockscout(chain, address) {
  const base = chain.blockscout;
  if (!base) return null;

  const { json } = await getJson(`${base}/api/v2/smart-contracts/${address}`, {
    referer: `${base}/address/${address}`,
  });
  if (!json) return null;

  if (Array.isArray(json.abi) && json.abi.length > 0) {
    return {
      abi: json.abi,
      source: "blockscout",
      verified: true,
      name: json.name || null,
      // Kontrak proxy: ABI implementasi yang menentukan, bukan proxy-nya.
      proxyOf: json.implementations?.[0]?.address || null,
    };
  }
  return null;
}

/* --------------------------------------------------- 2. ETHERSCAN V2 */

async function fromEtherscan(chain, address, apiKey) {
  if (!apiKey) return null;

  const url =
    `https://api.etherscan.io/v2/api?chainid=${chain.chainId}` +
    `&module=contract&action=getabi&address=${address}&apikey=${apiKey}`;
  const { json } = await getJson(url);
  if (!json || json.status !== "1" || typeof json.result !== "string") return null;

  try {
    const abi = JSON.parse(json.result);
    if (Array.isArray(abi) && abi.length > 0) {
      return { abi, source: "etherscan", verified: true, name: null, proxyOf: null };
    }
  } catch {
    /* result bukan JSON ABI */
  }
  return null;
}

/* ------------------------------------------ 3. FALLBACK BYTECODE */

/**
 * Selector muncul di bytecode EVM sebagai PUSH4 (opcode 0x63) + 4 byte.
 * Ini heuristik, bukan disassembler: bisa ada false positive (konstanta yang
 * kebetulan 4 byte). Tidak masalah — selector palsu tidak akan cocok dengan
 * nama fungsi apa pun di 4byte, jadi tersaring sendiri.
 */
export function selectorsFromBytecode(bytecode) {
  const hex = String(bytecode || "").replace(/^0x/, "");
  const out = new Set();
  for (let i = 0; i + 10 <= hex.length; i += 2) {
    if (hex.slice(i, i + 2) === "63") {
      const sel = hex.slice(i + 2, i + 10);
      if (/^[0-9a-f]{8}$/.test(sel) && sel !== "00000000" && sel !== "ffffffff") {
        out.add("0x" + sel);
      }
    }
  }
  return [...out];
}

/** Tanda tangan umum yang dicoba dulu — hemat request ke 4byte. */
const SIGNATURE_GUESSES = [
  // baca
  "name()", "symbol()", "totalSupply()", "MAX_SUPPLY()", "maxSupply()",
  "MAX_PER_TX()", "maxPerTx()", "maxPerWallet()", "MAX_PER_WALLET()",
  "price()", "mintPrice()", "currentPrice()", "cost()", "quote(uint256)",
  "mintActive()", "saleActive()", "publicSaleActive()", "paused()",
  "whitelistActive()", "presaleActive()", "allowlistActive()",
  "merkleRoot()", "root()", "isWhitelisted(address)", "whitelisted(address)",
  "numberMinted(address)", "minted(address)", "mintedBy(address)",
  "tierPrices(uint256)", "tierCaps(uint256)", "currentTier()", "owner()",
  // tulis / mint
  "mint(uint256)", "mint()", "mint(address,uint256)", "mintPublic(uint256)",
  "publicMint(uint256)", "mintSelected(uint256[])", "claim(uint256)",
  "whitelistMint(uint256,bytes32[])", "allowlistMint(uint256,bytes32[])",
  "presaleMint(uint256,bytes32[])", "mintWhitelist(uint256,bytes32[])",
  "claim(uint256,bytes32[])", "mintWithSignature(uint256,bytes)",
  "signatureMint(uint256,bytes)", "ownerMint(address,uint256)",
];

const GUESS_BY_SELECTOR = new Map(
  SIGNATURE_GUESSES.map((sig) => [keccak256(toUtf8Bytes(sig)).slice(0, 10), sig])
);

async function lookup4byte(selector) {
  try {
    const { json } = await getJson(
      `https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`
    );
    const results = json?.results || [];
    if (results.length === 0) return null;
    // 4byte bisa punya beberapa nama untuk satu selector (tabrakan sengaja
    // dari kontrak scam). Ambil yang paling tua = paling mungkin asli.
    const sorted = [...results].sort((a, b) => (a.id || 0) - (b.id || 0));
    return sorted[0].text_signature;
  } catch {
    return null;
  }
}

/** `mint(uint256)` -> entri ABI. */
export function signatureToAbiEntry(sig) {
  const m = /^([a-zA-Z_$][\w$]*)\((.*)\)$/.exec(sig);
  if (!m) return null;
  const [, name, argsRaw] = m;
  const types = argsRaw.trim() === "" ? [] : argsRaw.split(",").map((t) => t.trim());
  if (types.some((t) => !t)) return null;

  return {
    type: "function",
    name,
    inputs: types.map((t, i) => ({ type: t, name: `arg${i}` })),
    outputs: [],
    // Tidak bisa ditentukan dari selector saja. "payable" adalah pilihan aman:
    // mengirim value ke fungsi non-payable akan revert saat simulasi, dan itu
    // ketahuan sebelum gas terbuang.
    stateMutability: "payable",
  };
}

async function fromBytecode(bytecode, { max4byte = 40 } = {}) {
  const selectors = selectorsFromBytecode(bytecode);
  if (selectors.length === 0) return null;

  const entries = [];
  const unknown = [];

  for (const sel of selectors) {
    const guess = GUESS_BY_SELECTOR.get(sel);
    if (guess) {
      const e = signatureToAbiEntry(guess);
      if (e) entries.push({ ...e, _selector: sel, _from: "guess" });
    } else {
      unknown.push(sel);
    }
  }

  // Sisanya tanya 4byte, dibatasi supaya tidak menembak ratusan request.
  const toAsk = unknown.slice(0, max4byte);
  const sigs = await Promise.all(toAsk.map((s) => lookup4byte(s)));
  for (const [i, sig] of sigs.entries()) {
    if (!sig) continue;
    const e = signatureToAbiEntry(sig);
    if (e) entries.push({ ...e, _selector: toAsk[i], _from: "4byte" });
  }

  if (entries.length === 0) return null;

  // Dedupe per selector.
  const seen = new Set();
  const abi = entries.filter((e) => {
    if (seen.has(e._selector)) return false;
    seen.add(e._selector);
    return true;
  });

  return {
    abi,
    source: "bytecode",
    verified: false,
    name: null,
    proxyOf: null,
    selectorsTotal: selectors.length,
    selectorsNamed: abi.length,
  };
}

/* ------------------------------------------------------------ PUBLIK */

async function ethGetCode(rpcUrl, address) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getCode",
      params: [address, "latest"],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

/**
 * @returns {Promise<{abi, source, verified, name, proxyOf, bytecode}>}
 * @throws kalau alamat tidak valid, chain tidak didukung, atau bukan kontrak.
 */
export async function fetchAbi(address, chainIdentifier, { rpcUrl, etherscanKey } = {}) {
  if (!isAddress(address)) throw new Error("Alamat kontrak tidak valid.");

  const chain = getChain(chainIdentifier);
  if (!chain) throw new Error(`Chain tidak didukung: ${chainIdentifier}`);

  const rpc = rpcUrl || chain.defaultRpc;

  // Pastikan ini kontrak, bukan wallet biasa. Ini juga jadi bahan fallback.
  const bytecode = await ethGetCode(rpc, address);
  if (!bytecode || bytecode === "0x") {
    throw new Error("Alamat ini bukan kontrak (tidak ada bytecode).");
  }

  const found =
    (await fromBlockscout(chain, address).catch(() => null)) ||
    (await fromEtherscan(chain, address, etherscanKey).catch(() => null)) ||
    (await fromBytecode(bytecode).catch(() => null));

  if (!found) {
    throw new Error(
      "ABI tidak bisa diambil: kontrak belum diverifikasi dan tidak ada " +
        "selector yang dikenali dari bytecode."
    );
  }

  return { ...found, bytecode, chain: chain.identifier };
}
