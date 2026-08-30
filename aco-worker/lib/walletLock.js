/**
 * Kunci per wallet (mutex in-process).
 *
 * Kenapa perlu setelah job dibuat paralel:
 *
 *   Kalau user menjadwalkan 2 slug dengan wallet YANG SAMA dan windownya
 *   bertabrakan, dua job akan mengambil nonce "pending" pada saat yang sama.
 *   Keduanya dapat angka yang sama, lalu tx kedua MENIMPA tx pertama di
 *   mempool — satu mint hilang tanpa jejak, gas tetap terbakar.
 *
 *   Jadi bagian ambil-nonce → kirim-tx wajib berurutan PER WALLET, walau
 *   job-nya sendiri jalan bersamaan. Wallet berbeda tidak saling menunggu.
 *
 * Cukup in-process karena hanya ada satu worker per VPS. Kalau nanti worker
 * dijalankan lebih dari satu proses, kunci ini harus dipindah ke DB.
 */

const locks = new Map(); // address (lowercase) -> Promise rantai terakhir

/**
 * Jalankan `fn` dengan jaminan tidak ada pemanggil lain untuk address yang sama
 * berjalan bersamaan. Wallet lain tetap paralel.
 */
export async function withWalletLock(address, fn) {
  const key = String(address || "").toLowerCase();

  // Rantai promise: pemanggil baru menunggu pemanggil sebelumnya selesai.
  const prev = locks.get(key) ?? Promise.resolve();

  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });

  // Rantai disimpan SEBELUM await, supaya pemanggil berikutnya melihatnya.
  //
  // CATATAN: referensinya WAJIB disimpan di variabel. Versi pertama kode ini
  // membandingkan `locks.get(key) === prev.then(() => current)` di blok
  // finally — `.then()` membuat promise BARU tiap dipanggil, jadi
  // perbandingannya selalu false dan entri tidak pernah dihapus. Tes
  // menunjukkan 52 entri tersisa setelah 50 operasi (bocor).
  const chained = prev.then(() => current);
  locks.set(key, chained);

  await prev;

  try {
    return await fn();
  } finally {
    release();
    // Hapus hanya kalau tidak ada yang mengantre di belakang — kalau ada,
    // `locks.get(key)` sudah menunjuk rantai milik pemanggil berikutnya.
    if (locks.get(key) === chained) {
      locks.delete(key);
    }
  }
}

/** Untuk logging/diagnostik. */
export function lockedWalletCount() {
  return locks.size;
}
