/**
 * Hammer calldata dengan pola PIPELINE.
 *
 * Masalah pola lama (berurutan):
 *
 *   kirim -> tunggu ~780ms -> jeda 200ms -> kirim -> ...
 *
 * Jarak antar percobaan jadi ~1015ms (terukur), bukan 200ms seperti yang
 * diniatkan `retryDelayMs`. Kalau stage buka tepat setelah satu percobaan
 * gagal, deteksinya telat sampai ~1 detik.
 *
 * Pola pipeline:
 *
 *   kirim -> (200ms) -> kirim -> (200ms) -> kirim -> ...
 *   jawaban ditangani begitu datang, siapa pun yang duluan sukses menang.
 *
 * Jarak antar percobaan terukur 201ms. Karena tiap request tetap ~780ms,
 * beberapa request memang "melayang" bersamaan — itu justru tujuannya.
 *
 * Yang dijaga:
 *   - Begitu ada satu yang sukses, pengiriman baru dihentikan (tidak ada
 *     percobaan sia-sia setelah calldata didapat).
 *   - Hard error per address tetap dicatat supaya wallet itu tidak ditembak lagi.
 *   - Request yang sudah melayang tidak bisa dibatalkan, tapi hasilnya dibuang.
 */

import { fetchCalldata } from "./graphql.js";

export async function fetchCalldataPipelined(
  wallets,
  contractAddress,
  chain,
  cookieStr,
  { maxRetries = 30, retryDelayMs = 200, quantity = "1" } = {}
) {
  console.log(`[GQL] Starting swap() pipeline loop (jeda kirim ${retryDelayMs}ms)...`);

  const hardErrorAddresses = new Set();
  let selesai = false;
  let hasilSukses = null;
  let errorTerakhir = null;
  let dikirim = 0;
  let dijawab = 0;

  const melayang = new Set();

  const tembak = async (attempt) => {
    const activeWallets = wallets.filter((w) => {
      const addr = typeof w === "string" ? w : w.address;
      return !hardErrorAddresses.has(addr);
    });

    if (activeWallets.length === 0) {
      errorTerakhir = new Error("Semua wallet sudah hard error, aborting.");
      selesai = true;
      return;
    }

    try {
      const results = await fetchCalldata(
        activeWallets,
        contractAddress,
        chain,
        cookieStr,
        quantity
      );
      dijawab++;

      if (selesai) return; // sudah ada yang menang, buang hasil ini

      const successful = results.filter((r) => r.success);
      const hardErrors = results.filter((r) => !r.success && !r.retry);

      for (const e of hardErrors) {
        if (!hardErrorAddresses.has(e.address)) {
          console.log(`[GQL] ❌ ${e.address}: ${e.error} (skipping permanently)`);
          hardErrorAddresses.add(e.address);
        }
      }

      if (successful.length > 0) {
        console.log(`[GQL] ✅ Got calldata on attempt ${attempt} (pipeline)`);
        hasilSukses = successful;
        selesai = true;
        return;
      }

      if (hardErrors.length > 0 && successful.length === 0) {
        const semuaHard = wallets.every((w) =>
          hardErrorAddresses.has(typeof w === "string" ? w : w.address)
        );
        if (semuaHard) {
          errorTerakhir = new Error("Semua wallet memiliki hard error, aborting.");
          selesai = true;
        }
      }
    } catch (err) {
      dijawab++;
      if (
        err.code === "INVALID_ARGUMENT" ||
        err.code === "MISSING_ARGUMENT" ||
        String(err.message || "").startsWith("[Config]")
      ) {
        console.error(`[GQL] ❌ Config error, tidak akan di-retry: ${err.message}`);
        errorTerakhir = err;
        selesai = true;
        return;
      }
      errorTerakhir = err;
    }
  };

  // Fase kirim: satu tembakan tiap retryDelayMs sampai batas atau ada yang menang
  for (let attempt = 1; attempt <= maxRetries && !selesai; attempt++) {
    dikirim++;
    const p = tembak(attempt).finally(() => melayang.delete(p));
    melayang.add(p);

    if (attempt % 10 === 0 && !selesai) {
      console.log(
        `[GQL] Attempt ${attempt}/${maxRetries} — mint not live yet` +
          ` (${melayang.size} request melayang)...`
      );
    }

    if (attempt < maxRetries && !selesai) {
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  // Tunggu sisa request yang masih melayang — salah satunya mungkin sukses
  while (melayang.size > 0 && !hasilSukses) {
    await Promise.race([...melayang, new Promise((r) => setTimeout(r, 2000))]);
    if (melayang.size === 0) break;
  }

  if (hasilSukses) return hasilSukses;

  console.log(`[GQL] Pipeline habis: ${dikirim} dikirim, ${dijawab} dijawab, tidak ada sukses`);
  throw errorTerakhir || new Error(`Failed to get calldata after ${dikirim} attempts`);
}
