/**
 * Registry platform ACO.
 *
 * ACO sekarang mendukung OpenSea. Scatter dan mint-by-contract disiapkan
 * strukturnya supaya penambahannya nanti tidak membongkar UI/DB — tinggal
 * ubah `status` jadi "ready" dan isi worker handler-nya.
 *
 * Catatan soal mint-by-contract: itu yang paling rumit karena tidak ada API
 * yang memberi calldata. Worker harus menyusun calldata sendiri dari ABI +
 * nama fungsi + argumen, dan tiap kontrak berbeda. Karena itu `needsAbi`
 * ditandai di sini — UI wajib meminta ABI dari user untuk platform itu.
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
    id: "scatter",
    label: "Scatter",
    short: "SC",
    status: "soon",
    needsAbi: false,
    needsAuth: false,
    description:
      "Mint lewat Scatter (scatter.art). Belum aktif — endpoint dan bentuk calldata-nya masih perlu dipetakan.",
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

export const DEFAULT_PLATFORM = "opensea";
