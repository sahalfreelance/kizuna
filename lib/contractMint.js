/**
 * Analisa kontrak mint: pilih fungsi mint, deteksi WHITELIST vs FCFS, baca
 * harga & supply. Tujuannya user cuma menempel alamat kontrak — sisanya
 * disimpulkan dari ABI + state on-chain.
 *
 * Kenapa penting: salah pilih fungsi atau salah argumen berarti transaksi
 * revert dan gas terbuang. Karena itu setiap dugaan di sini WAJIB lewat
 * simulasi (`eth_call`) sebelum dikirim — lihat `simulateMint()`.
 */

import { Interface, JsonRpcProvider } from "ethers";

/** Nama fungsi yang jelas BUKAN untuk publik. */
const OWNER_ONLY = /^(owner|admin|dev|team|reserve|air|gift|promo)/i;

/**
 * Bukan fungsi mint walau namanya mengandung "mint":
 * - `setMintActive` dst = setter admin
 * - `mintActive`, `mintEnabled` = flag baca, bukan aksi
 * - `mintPrice`, `mintedBy`, `numberMinted` = getter
 *
 * Penting karena jalur fallback bytecode tidak tahu `view` vs `payable` —
 * semuanya ditandai payable, jadi penyaringan harus dari nama.
 */
const NOT_A_MINT = [
  /^set[A-Z_]/,
  /(active|enabled|open|opened|paused|started|live|status)$/i,
  /(price|cost|fee|supply|count|limit|max|balance|uri)$/i,
  /^(minted|numberminted|mintedby|mintsof)$/i,
];

/** Argumen yang menandakan butuh bukti whitelist. */
const PROOF_TYPES = new Set(["bytes32[]", "bytes", "bytes32"]);

/**
 * Klasifikasi kandidat fungsi mint dari ABI.
 *
 * Skor lebih tinggi = lebih mungkin fungsi mint publik yang kita mau.
 */
export function findMintFunctions(abi) {
  const fns = (abi || []).filter((e) => e.type === "function");
  const out = [];

  for (const fn of fns) {
    const name = fn.name || "";
    const lower = name.toLowerCase();
    if (!/mint|claim|purchase|buy/.test(lower)) continue;
    if (NOT_A_MINT.some((re) => re.test(name))) continue;
    // Fungsi baca tidak bisa mengubah state -> bukan mint. Hanya berlaku kalau
    // ABI-nya asli (verified); fallback bytecode tidak punya info ini.
    if (fn.stateMutability === "view" || fn.stateMutability === "pure") continue;

    const inputs = fn.inputs || [];
    const types = inputs.map((i) => i.type);

    // Fungsi khusus owner: tetap dicatat tapi skornya ditekan supaya tidak
    // pernah terpilih otomatis.
    const ownerOnly = OWNER_ONLY.test(name);

    const needsProof = types.some((t) => PROOF_TYPES.has(t));
    const hasQty = types.some((t) => /^uint(8|16|32|64|128|256)?$/.test(t));
    const hasRecipient = types.some((t) => t === "address");
    const hasTokenIds = types.some((t) => /^uint\d*\[\]$/.test(t));

    let score = 0;
    if (/^mint$/i.test(name)) score += 50;
    else if (/^(publicmint|mintpublic)$/i.test(name)) score += 45;
    else if (/^(whitelistmint|allowlistmint|presalemint|mintwhitelist)$/i.test(name)) score += 40;
    else if (/^claim$/i.test(name)) score += 35;
    else score += 10;

    if (hasQty) score += 10;
    if (types.length === 0) score += 5; // mint() tanpa argumen
    if (needsProof) score -= 5;         // butuh data tambahan
    if (ownerOnly) score -= 100;

    out.push({
      name,
      signature: `${name}(${types.join(",")})`,
      inputs,
      types,
      stateMutability: fn.stateMutability || "nonpayable",
      payable: fn.stateMutability === "payable" || fn.payable === true,
      needsProof,
      hasQty,
      hasRecipient,
      hasTokenIds,
      ownerOnly,
      score,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------- BACA STATE KONTRAK */

/** Fungsi baca tanpa argumen yang menarik untuk mint, beserta artinya. */
const READ_PROBES = [
  ["name", "string"],
  ["symbol", "string"],
  ["totalSupply", "uint256"],
  ["maxSupply", "uint256"],
  ["MAX_SUPPLY", "uint256"],
  ["MAX_PER_TX", "uint256"],
  ["maxPerTx", "uint256"],
  ["maxPerWallet", "uint256"],
  ["MAX_PER_WALLET", "uint256"],
  ["price", "uint256"],
  ["mintPrice", "uint256"],
  ["currentPrice", "uint256"],
  ["cost", "uint256"],
  ["mintActive", "bool"],
  ["saleActive", "bool"],
  ["publicSaleActive", "bool"],
  ["paused", "bool"],
  ["whitelistActive", "bool"],
  ["presaleActive", "bool"],
  ["allowlistActive", "bool"],
  ["merkleRoot", "bytes32"],
  ["root", "bytes32"],
  ["currentTier", "uint256"],
];

const ZERO_ROOT = "0x" + "0".repeat(64);

/**
 * Baca state kontrak lewat satu provider. Fungsi yang tidak ada di ABI
 * dilewati; yang ada tapi revert dicatat null (tidak menggagalkan semuanya).
 */
export async function readContractState(address, abi, rpcUrl) {
  // Guard wajib: JsonRpcProvider dengan url undefined tidak error, tapi
  // mencoba ulang tanpa henti ("failed to detect network ... retry in 1s")
  // dan menggantung proses. Lebih baik gagal langsung.
  if (!rpcUrl || typeof rpcUrl !== "string") {
    throw new Error("readContractState: rpcUrl wajib diisi.");
  }
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const iface = new Interface(abi);

  const available = new Set(
    (abi || [])
      .filter((e) => e.type === "function" && (e.inputs || []).length === 0)
      .map((e) => e.name)
  );

  const state = {};
  const jobs = [];

  for (const [fnName, kind] of READ_PROBES) {
    if (!available.has(fnName)) continue;
    jobs.push(
      (async () => {
        try {
          const data = iface.encodeFunctionData(fnName, []);
          const raw = await provider.call({ to: address, data });
          if (!raw || raw === "0x") return;
          state[fnName] = decodeSimple(raw, kind);
        } catch {
          /* revert / tipe tak cocok: abaikan probe ini */
        }
      })()
    );
  }

  await Promise.all(jobs);
  return state;
}

function decodeSimple(raw, kind) {
  if (kind === "bool") return BigInt(raw) !== 0n;
  if (kind === "uint256") return BigInt(raw).toString();
  if (kind === "bytes32") return raw.slice(0, 66);
  if (kind === "string") {
    try {
      if (raw.length < 130) return null;
      const len = Number(BigInt("0x" + raw.slice(66, 130)));
      return Buffer.from(raw.slice(130, 130 + len * 2), "hex").toString("utf8");
    } catch {
      return null;
    }
  }
  return raw;
}

/* ------------------------------------------ DETEKSI WHITELIST vs FCFS */

/**
 * Simpulkan mode mint dari ABI + state.
 *
 * @returns {{mode: "FCFS"|"WHITELIST"|"UNKNOWN", reason: string, gated: boolean}}
 *
 * `gated: true` artinya mint kemungkinan ditutup sekarang (flag aktif = false).
 * Itu BUKAN error — worker memang menunggu window terbuka.
 */
export function detectMintMode(abi, state, mintFns) {
  const merkle = state.merkleRoot ?? state.root ?? null;
  const merkleSet = merkle && merkle !== ZERO_ROOT;

  const wlFlag =
    state.whitelistActive ?? state.presaleActive ?? state.allowlistActive ?? null;
  const pubFlag = state.mintActive ?? state.saleActive ?? state.publicSaleActive ?? null;

  const publicFns = mintFns.filter((f) => !f.ownerOnly && !f.needsProof);
  const proofFns = mintFns.filter((f) => !f.ownerOnly && f.needsProof);

  // Whitelist aktif dan ada fungsi yang minta proof -> jalur WL.
  if (wlFlag === true && proofFns.length > 0) {
    return {
      mode: "WHITELIST",
      reason: "flag whitelist aktif dan ada fungsi mint yang meminta proof",
      gated: false,
    };
  }

  // Public flag aktif -> FCFS, siapa cepat dia dapat.
  if (pubFlag === true && publicFns.length > 0) {
    return { mode: "FCFS", reason: "flag mint publik aktif", gated: false };
  }

  // Merkle root terisi tapi tidak ada flag apa pun: kontrak berbasis WL.
  if (merkleSet && proofFns.length > 0 && pubFlag !== true) {
    return {
      mode: "WHITELIST",
      reason: "merkleRoot terisi, mint publik belum aktif",
      gated: wlFlag === false,
    };
  }

  // Tidak ada proof di ABI sama sekali -> tidak mungkin WL merkle.
  if (proofFns.length === 0 && publicFns.length > 0) {
    return {
      mode: "FCFS",
      reason:
        pubFlag === false
          ? "hanya ada fungsi mint publik; flag mint masih false (belum dibuka)"
          : "hanya ada fungsi mint publik, tanpa parameter proof",
      gated: pubFlag === false,
    };
  }

  return {
    mode: "UNKNOWN",
    reason: "pola mint tidak dikenali; pilih fungsi manual lalu simulasikan",
    gated: false,
  };
}

/** Harga per token, dari state atau quote(). null = tidak diketahui. */
export function priceFromState(state) {
  for (const k of ["currentPrice", "mintPrice", "price", "cost"]) {
    if (state[k] != null) return state[k];
  }
  return null;
}
