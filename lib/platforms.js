/**
 * Registry platform ACO.
 *
 * Yang aktif sekarang: OpenSea. Mintbay, Scatter, dan mint-by-contract
 * disiapkan strukturnya supaya penambahannya nanti tidak membongkar UI/DB —
 * tinggal ubah `status` jadi "ready" dan isi worker handler-nya.
 *
 * Mint-by-contract TIDAK butuh ABI dari user: `lib/abiFetch.js` mengambilnya
 * otomatis, dan kalau kontraknya tidak verified, ABI direkonstruksi dari
 * selector di bytecode. Setiap calldata wajib lolos `eth_call` sebelum tx
 * dikirim, jadi salah tebak argumen tidak membakar gas.
 *
 * URUTAN di array ini = urutan tab di halaman /aco.
 */

export const PLATFORMS = [
  {
    id: "opensea",
    label: "OpenSea",
    short: "OS",
    status: "ready",
    // Calldata datang dari GraphQL OpenSea (swap mutation), jadi tidak perlu ABI.
    needsAbi: false,
    // Butuh login SIWE per wallet + API key.
    needsAuth: true,
    description:
      "Mint drop OpenSea. Calldata diambil dari API OpenSea, stage & jadwal terdeteksi otomatis dari slug.",
    inputLabel: "Collection slug",
    inputPlaceholder: "nama-collection (dari url opensea.io/collection/...)",
  },
  {
    id: "mintbay",
    label: "Mintbay",
    short: "MB",
    status: "soon",
    needsAbi: false,
    needsAuth: false,
    description:
      "Mint lewat Mintbay (mintbay.co). Belum aktif — endpoint jadwal stage dan bentuk calldata mint-nya masih perlu dipetakan.",
    // Terverifikasi: mintbay.co hidup (HTTP 200) dan dibangun dengan Next.js,
    // artinya datanya kemungkinan lewat route handler / server action, bukan
    // REST publik. Perlu dipetakan dari network tab sebelum bisa dipakai.
    pendingWork:
      "Petakan endpoint Mintbay untuk ambil jadwal stage + calldata mint.",
    inputLabel: "Collection slug / URL",
    inputPlaceholder: "slug atau url mintbay.co",
  },
  {
    id: "scatter",
    label: "Scatter",
    short: "SC",
    status: "soon",
    needsAbi: false,
    needsAuth: false,
    description:
      "Mint lewat Scatter (scatter.art). Belum aktif — endpoint dan bentuk calldata-nya masih perlu dipetakan.",
    pendingWork:
      "Petakan endpoint Scatter untuk ambil jadwal stage + calldata mint.",
    inputLabel: "Collection slug / URL",
    inputPlaceholder: "slug scatter",
  },
  {
    id: "contract",
    label: "Mint by Contract",
    short: "CT",
    status: "ready",
    // ABI diambil otomatis (Blockscout -> Etherscan -> bytecode+4byte), jadi
    // user tidak perlu menempel apa pun. Lihat lib/abiFetch.js.
    needsAbi: false,
    needsAuth: false,
    description:
      "Mint langsung ke kontrak. ABI, fungsi mint, dan mode (FCFS/whitelist) dideteksi otomatis dari alamat kontrak.",
    inputLabel: "Alamat kontrak",
    inputPlaceholder: "0x…",
  },
];

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));

export function getPlatform(id) {
  return BY_ID.get(String(id || "").toLowerCase()) || null;
}

export function isPlatformReady(id) {
  return getPlatform(id)?.status === "ready";
}

export function isValidPlatform(id) {
  return BY_ID.has(String(id || "").toLowerCase());
}

/** Semua id platform — dipakai untuk menyusun constraint SQL. */
export const PLATFORM_IDS = PLATFORMS.map((p) => p.id);

export const DEFAULT_PLATFORM = "opensea";
