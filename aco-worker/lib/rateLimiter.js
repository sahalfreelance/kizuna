/**
 * Rate limiter per host: token bucket + penghormatan Retry-After.
 *
 * Kenapa perlu:
 *   Saat mint, worker menembak gql.opensea.io dan RPC ratusan kali dalam
 *   hitungan detik (hammer calldata 300x @200ms, dikali jumlah wallet). Tanpa
 *   pembatas, kita sendiri yang memicu 429 — lalu semua wallet ikut kena, dan
 *   justru kalah dari yang tidak digeber.
 *
 * Cara kerja:
 *   - Tiap host punya bucket sendiri (opensea.io beda dari alchemy.com)
 *   - Token diisi ulang terus-menerus sesuai `ratePerSec`
 *   - Kalau token habis, pemanggil MENUNGGU, bukan ditolak
 *   - Kalau server membalas 429 dengan Retry-After, seluruh host itu
 *     "didinginkan" sampai waktu yang diminta — ini yang paling penting,
 *     karena mengabaikan Retry-After biasanya berujung blokir lebih lama
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Bucket {
  constructor({ ratePerSec, burst }) {
    this.ratePerSec = ratePerSec;
    this.burst = burst;
    this.tokens = burst;
    this.lastRefill = Date.now();
    this.cooldownUntil = 0;
    this.waiting = 0;
    this.stats = { granted: 0, waited: 0, cooldowns: 0, totalWaitMs: 0 };
  }

  refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSec);
      this.lastRefill = now;
    }
  }

  /** Tunggu sampai boleh mengirim satu request. */
  async acquire() {
    const startedAt = Date.now();
    this.waiting++;

    try {
      // Loop, bukan sekali hitung: selama menunggu bisa muncul cooldown baru
      // dari request lain yang kena 429.
      for (;;) {
        const now = Date.now();

        if (now < this.cooldownUntil) {
          await sleep(Math.min(this.cooldownUntil - now, 2000));
          continue;
        }

        this.refill();

        if (this.tokens >= 1) {
          this.tokens -= 1;
          this.stats.granted++;
          const waited = Date.now() - startedAt;
          if (waited > 5) {
            this.stats.waited++;
            this.stats.totalWaitMs += waited;
          }
          return;
        }

        // Berapa lama sampai 1 token tersedia.
        const needed = (1 - this.tokens) / this.ratePerSec * 1000;
        await sleep(Math.max(20, Math.min(needed, 2000)));
      }
    } finally {
      this.waiting--;
    }
  }

  /** Dipanggil saat server membalas 429. */
  penalize(retryAfterMs) {
    const until = Date.now() + retryAfterMs;
    if (until > this.cooldownUntil) {
      this.cooldownUntil = until;
      this.stats.cooldowns++;
    }
    // Kosongkan token supaya tidak ada ledakan request tepat setelah cooldown.
    this.tokens = 0;
  }
}

// Batas default per host — DIUKUR, bukan ditebak.
//
// Angka lama (8/s) ditebak konservatif. Pengukuran dari VPS ini ke
// gql.opensea.io: 80 request BERSAMAAN semuanya 200, nol 429.
//
// Temuan penting: 429 yang muncul di log BUKAN karena volume. Request dengan
// header minimal langsung 429 di percobaan pertama, sementara request dengan
// user-agent + origin lolos 80 sekaligus. Jadi pemicunya FINGERPRINT
// (dianggap bot), bukan jumlah. Menurunkan rate tidak menyembuhkan itu.
//
// Angka di bawah dinaikkan mendekati hasil ukur dengan margin aman. Ini bukan
// izin membanjiri — cuma berhenti menghambat diri sendiri tanpa alasan.
// PENGUKURAN LANJUTAN (target 200 user):
//
//   Gelombang tunggal:
//     25 → p50 908ms · 50 → 875ms · 75 → 867ms
//    100 → p50 948ms · 150 → 999ms · 200 → p50 1079ms, 429:0 err:0
//
//   Beban BERKELANJUTAN (yang relevan untuk hammer):
//     25 req/s × 4s → p50 769ms, melayang puncak 21
//     50 req/s × 4s → p50 773ms, melayang puncak 43
//    100 req/s × 4s → p50 766ms, melayang puncak 79, nol 429
//
// 100 req/s berkelanjutan TIDAK menaikkan latensi sama sekali. Jadi batas 25/s
// adalah penghambat buatan: dengan pola hammer pipeline (5 tembakan/detik per
// job), 200 job butuh ~1000 req/s dan batas 25/s akan menumpuk antrean 40 detik
// — mint dijamin kelewat.
//
// Dinaikkan ke 120/s dengan burst 240. Ini di atas hasil ukur berkelanjutan
// (100/s) tapi masih jauh di bawah titik rusak; burst besar supaya lonjakan
// "semua job mulai hammer di detik yang sama" tidak diperlambat.
const DEFAULTS = {
  "gql.opensea.io": { ratePerSec: 120, burst: 240 },
  "opensea.io": { ratePerSec: 20, burst: 40 },
  "api.opensea.io": { ratePerSec: 4, burst: 8 }, // REST resmi, batasnya nyata
  __default: { ratePerSec: 15, burst: 30 },
};

const buckets = new Map();

function hostOf(urlOrHost) {
  const s = String(urlOrHost || "");
  if (!s) return "unknown";
  try {
    return new URL(s).hostname;
  } catch {
    return s;
  }
}

function bucketFor(urlOrHost) {
  const host = hostOf(urlOrHost);
  if (!buckets.has(host)) {
    const cfg = DEFAULTS[host] || DEFAULTS.__default;
    buckets.set(host, new Bucket(cfg));
  }
  return buckets.get(host);
}

/** Tunggu izin sebelum menembak host ini. */
export async function acquire(urlOrHost) {
  return bucketFor(urlOrHost).acquire();
}

/**
 * Parse header Retry-After (detik atau HTTP-date), lalu dinginkan host itu.
 * Kalau header tidak ada, pakai default 2 detik.
 */
export function penalize(urlOrHost, retryAfterHeader) {
  let ms = 2000;

  if (retryAfterHeader) {
    const asNum = Number(retryAfterHeader);
    if (Number.isFinite(asNum)) {
      ms = asNum * 1000;
    } else {
      const asDate = new Date(retryAfterHeader).getTime();
      if (!Number.isNaN(asDate)) ms = Math.max(0, asDate - Date.now());
    }
  }

  // Batasi supaya server yang mengirim Retry-After ekstrem tidak membekukan
  // worker selama sisa hidupnya.
  ms = Math.max(500, Math.min(ms, 60000));

  bucketFor(urlOrHost).penalize(ms);
  return ms;
}

/** Apakah host sedang dalam cooldown. */
export function isCoolingDown(urlOrHost) {
  return Date.now() < bucketFor(urlOrHost).cooldownUntil;
}

/**
 * `fetch` yang menghormati rate limit.
 *
 * Otomatis: menunggu token sebelum kirim, dan kalau dapat 429, mencatat
 * Retry-After lalu melempar error yang bisa dikenali retry.js sebagai
 * RATE_LIMIT.
 */
export async function limitedFetch(url, options = {}) {
  await acquire(url);

  const res = await fetch(url, options);

  if (res.status === 429) {
    const waited = penalize(url, res.headers.get("retry-after"));
    const err = new Error(`429 Too Many Requests (${hostOf(url)}), cooldown ${waited}ms`);
    err.status = 429;
    err.retryAfterMs = waited;
    throw err;
  }

  // 5xx juga menandakan server sedang bermasalah — beri jeda kecil supaya
  // tidak memperparah.
  if (res.status >= 500) {
    penalize(url, "1");
  }

  return res;
}

export function statsSnapshot() {
  const out = {};
  for (const [host, b] of buckets) {
    out[host] = {
      ...b.stats,
      tokens: Number(b.tokens.toFixed(2)),
      coolingDown: Date.now() < b.cooldownUntil,
      waiting: b.waiting,
    };
  }
  return out;
}

export function resetAll() {
  buckets.clear();
}
