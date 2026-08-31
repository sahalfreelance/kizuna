/**
 * Semaphore sederhana: batasi berapa operasi boleh jalan bersamaan.
 *
 * Dipakai untuk membatasi FASE MINT saja, bukan seluruh hidup job.
 *
 * Kenapa itu penting: job ACO hidupnya bisa berjam-jam, tapi 99% waktunya cuma
 * MENUNGGU window (tidur, sesekali cek pembatalan). Yang benar-benar padat —
 * hammer calldata, preflight, kirim tx — cuma beberapa detik di ujung.
 *
 * Kalau batas konkurensi dipasang di seluruh job, slot tertahan berjam-jam dan
 * user ke-9 harus menunggu job ke-1 SELESAI. Itu bukan pembatasan beban, itu
 * antrean. Semaphore ini dipasang hanya di detik-detik mint.
 */

export class Semaphore {
  constructor(max, { name = "sem" } = {}) {
    this.max = Math.max(1, max);
    this.name = name;
    this.active = 0;
    this.queue = [];
    this.peak = 0;
    this.totalWaitedMs = 0;
    this.waitedCount = 0;
  }

  /**
   * Jalankan fn dengan jaminan tidak lebih dari `max` yang bersamaan.
   * @param {(info: {waitedMs: number}) => Promise<any>} fn
   */
  async run(fn) {
    const t0 = Date.now();
    await this.#acquire();
    const waitedMs = Date.now() - t0;

    if (waitedMs > 5) {
      this.waitedCount++;
      this.totalWaitedMs += waitedMs;
    }

    try {
      return await fn({ waitedMs });
    } finally {
      this.#release();
    }
  }

  #acquire() {
    if (this.active < this.max) {
      this.active++;
      this.peak = Math.max(this.peak, this.active);
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  #release() {
    const next = this.queue.shift();
    if (next) {
      // Slot langsung diteruskan ke yang mengantre; `active` tidak turun.
      next();
    } else {
      this.active--;
    }
  }

  stats() {
    return {
      name: this.name,
      max: this.max,
      active: this.active,
      waiting: this.queue.length,
      peak: this.peak,
      avgWaitMs: this.waitedCount ? Math.round(this.totalWaitedMs / this.waitedCount) : 0,
    };
  }
}
