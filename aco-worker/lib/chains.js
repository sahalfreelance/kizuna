/**
 * Chain yang didukung ACO.
 *
 * `identifier` = nilai yang dipakai OpenSea di GraphQL (`chain { identifier }`),
 * terverifikasi dari respons API asli: "ethereum", "base", dst.
 *
 * `chainId` = EVM chain id, dipakai untuk SIWE login dan mengirim transaksi.
 * Ini HARUS benar — kalau salah, tanda tangan SIWE ditolak OpenSea dan
 * transaksi bisa dikirim ke jaringan yang salah.
 *
 * `defaultRpc` = RPC publik gratis, dipakai kalau user belum menyimpan RPC
 * sendiri. Publik artinya rate-limit ketat dan bisa lambat — untuk mint yang
 * kompetitif user sebaiknya pakai RPC sendiri (Alchemy/Infura/QuickNode).
 */

export const SUPPORTED_CHAINS = [
  {
    identifier: "ethereum",
    chainId: 1,
    label: "Ethereum",
    symbol: "ETH",
    explorer: "https://etherscan.io",
    defaultRpc: "https://ethereum-rpc.publicnode.com",
  },
  {
    identifier: "base",
    chainId: 8453,
    label: "Base",
    symbol: "ETH",
    explorer: "https://basescan.org",
    defaultRpc: "https://base-rpc.publicnode.com",
  },
  {
    identifier: "arbitrum",
    chainId: 42161,
    label: "Arbitrum One",
    symbol: "ETH",
    explorer: "https://arbiscan.io",
    defaultRpc: "https://arbitrum-one-rpc.publicnode.com",
  },
  {
    identifier: "optimism",
    chainId: 10,
    label: "Optimism",
    symbol: "ETH",
    explorer: "https://optimistic.etherscan.io",
    defaultRpc: "https://optimism-rpc.publicnode.com",
  },
  {
    identifier: "polygon",
    chainId: 137,
    label: "Polygon",
    symbol: "POL",
    explorer: "https://polygonscan.com",
    defaultRpc: "https://polygon-bor-rpc.publicnode.com",
  },
  {
    identifier: "zora",
    chainId: 7777777,
    label: "Zora",
    symbol: "ETH",
    explorer: "https://explorer.zora.energy",
    defaultRpc: "https://rpc.zora.energy",
  },
  {
    identifier: "blast",
    chainId: 81457,
    label: "Blast",
    symbol: "ETH",
    explorer: "https://blastscan.io",
    defaultRpc: "https://rpc.blast.io",
  },
  {
    identifier: "avalanche",
    chainId: 43114,
    label: "Avalanche",
    symbol: "AVAX",
    explorer: "https://snowtrace.io",
    defaultRpc: "https://avalanche-c-chain-rpc.publicnode.com",
  },
  {
    identifier: "sei",
    chainId: 1329,
    label: "Sei",
    symbol: "SEI",
    explorer: "https://seitrace.com",
    defaultRpc: "https://evm-rpc.sei-apis.com",
  },
  {
    identifier: "ape_chain",
    chainId: 33139,
    label: "ApeChain",
    symbol: "APE",
    explorer: "https://apescan.io",
    defaultRpc: "https://rpc.apechain.com",
  },
  {
    identifier: "ronin",
    chainId: 2020,
    label: "Ronin",
    symbol: "RON",
    explorer: "https://app.roninchain.com",
    // api.roninchain.com/rpc menolak request tanpa API key (403), jadi dipakai
    // dRPC yang terbuka. Terverifikasi: chainId 2020.
    defaultRpc: "https://ronin.drpc.org",
  },
  {
    identifier: "ink",
    chainId: 57073,
    label: "Ink",
    symbol: "ETH",
    explorer: "https://explorer.inkonchain.com",
    defaultRpc: "https://rpc-gel.inkonchain.com",
  },
];

const BY_IDENTIFIER = new Map(SUPPORTED_CHAINS.map((c) => [c.identifier, c]));

export function getChain(identifier) {
  return BY_IDENTIFIER.get(String(identifier || "").toLowerCase()) || null;
}

export function isSupportedChain(identifier) {
  return BY_IDENTIFIER.has(String(identifier || "").toLowerCase());
}

export function chainIdOf(identifier) {
  return getChain(identifier)?.chainId ?? null;
}

export function explorerTxUrl(identifier, txHash) {
  const chain = getChain(identifier);
  if (!chain || !txHash) return null;
  return `${chain.explorer}/tx/${txHash}`;
}

/**
 * Validasi RPC URL yang diinput user.
 *
 * Selain memastikan bentuknya benar, ini juga menolak alamat internal
 * (localhost, 10.x, 192.168.x, dst). Tanpa itu, endpoint yang menerima URL
 * dari user dan menghubunginya dari server bisa dipakai untuk memindai
 * jaringan internal — SSRF.
 */
export function validateRpcUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, error: "RPC URL kosong." };
  if (s.length > 500) return { ok: false, error: "RPC URL terlalu panjang." };

  let url;
  try {
    url = new URL(s);
  } catch {
    return { ok: false, error: "RPC URL tidak valid." };
  }

  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
    return { ok: false, error: "RPC harus http(s):// atau ws(s)://" };
  }

  const host = url.hostname.toLowerCase();

  const isPrivate =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === "[::1]" ||
    host === "::1";

  if (isPrivate) {
    return { ok: false, error: "RPC tidak boleh menunjuk ke alamat internal/lokal." };
  }

  return { ok: true, url: s, host: url.hostname };
}
