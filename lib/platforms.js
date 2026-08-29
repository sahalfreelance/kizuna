/**
 * Registry platform ACO.
 *
 * Yang aktif sekarang: OpenSea. Mintbay, Scatter, dan mint-by-contract
 * disiapkan strukturnya supaya penambahannya nanti tidak membongkar UI/DB —
 * tinggal ubah `status` jadi "ready" dan isi worker handler-nya.
 *
 * Catatan soal mint-by-contract: itu yang paling rumit karena tidak ada API
 * yang memberi calldata. Worker harus menyusun calldata sendiri dari ABI +
 * nama fungsi + argumen, dan tiap kontrak berbeda. Karena itu `needsAbi`
 * ditandai di sini — UI wajib meminta ABI dari user untuk platform itu.
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
    status: "soon",
    // Tidak ada API yang memberi calldata -> harus disusun dari ABI.
    needsAbi: true,
    needsAuth: false,
    description:
      "Mint langsung ke kontrak, tanpa marketplace. Butuh alamat kontrak, ABI fungsi mint, dan argumennya. Paling fleksibel tapi paling rawan salah — argumen yang keliru berarti gas terbuang.",
    pendingWork:
      "Bangun penyusun calldata dari ABI. Tiap kontrak beda nama fungsi dan argumen, jadi tidak bisa dideteksi otomatis seperti OpenSea — user harus memberi ABI dan argumennya sendiri.",
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
