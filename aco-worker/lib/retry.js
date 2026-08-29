/**
 * Klasifikasi error + retry dengan backoff.
 *
 * Inti idenya: JANGAN ulangi error yang pasti gagal lagi, dan JANGAN pernah
 * mengulang transaksi yang mungkin sudah terkirim.
 *
 * Kesalahan paling berbahaya di auto-retry mint adalah mengirim transaksi dua
 * kali karena percobaan pertama dianggap gagal padahal sudah masuk mempool —
 * itu bisa jadi double mint dan gas terbuang dua kali. Karena itu error
 * pengiriman transaksi ditandai `unsafeToRetry` dan tidak diulang otomatis.
 */

export const ErrorKind = {
  RATE_LIMIT: "RATE_LIMIT",       // 429 / "too many requests"
  RPC_DOWN: "RPC_DOWN",           // timeout, ECONNRESET, 5xx
  NOT_LIVE: "NOT_LIVE",           // stage belum buka
  NOT_ELIGIBLE: "NOT_ELIGIBLE",   // wallet tidak masuk allowlist
  SOLD_OUT: "SOLD_OUT",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  WOULD_REVERT: "WOULD_REVERT",   // simulasi memperkirakan revert
  NONCE: "NONCE",                 // nonce terlalu rendah / sudah dipakai
  AUTH: "AUTH",                   // 401/403, API key ditolak
  TX_SENT_UNKNOWN: "TX_SENT_UNKNOWN", // tx mungkin terkirim, status tak jelas
  UNKNOWN: "UNKNOWN",
};

/**
 * Sifat tiap jenis error:
 *   retryable     : layak dicoba lagi
 *   unsafeToRetry : JANGAN diulang otomatis (risiko tx dobel)
 *   switchRpc     : pindah ke RPC lain sebelum mencoba lagi
 *   fatal         : hentikan wallet ini, percobaan berikutnya pasti sama
 */
const TRAITS = {
  [ErrorKind.RATE_LIMIT]: { retryable: true, switchRpc: true },
  [ErrorKind.RPC_DOWN]: { retryable: true, switchRpc: true },
  [ErrorKind.NOT_LIVE]: { retryable: true },
  [ErrorKind.NONCE]: { retryable: true },
  [ErrorKind.AUTH]: { retryable: true },
  [ErrorKind.NOT_ELIGIBLE]: { fatal: true },
  [ErrorKind.SOLD_OUT]: { fatal: true },
  [ErrorKind.INSUFFICIENT_FUNDS]: { fatal: true },
  [ErrorKind.WOULD_REVERT]: { fatal: true },
  [ErrorKind.TX_SENT_UNKNOWN]: { unsafeToRetry: true },
  [ErrorKind.UNKNOWN]: { retryable: true },
};

export function traitsOf(kind) {
  return TRAITS[kind] || TRAITS[ErrorKind.UNKNOWN];
}

/** Tebak jenis error dari pesan/kode. */
export function classifyError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "");

  // Urutan pemeriksaan penting: yang lebih spesifik didahulukan.

  if (msg.includes("429") || msg.includes("too many request") || msg.includes("rate limit")) {
    return ErrorKind.RATE_LIMIT;
  }
  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("invalid api key")) {
    return ErrorKind.AUTH;
  }
  if (
    msg.includes("insufficient funds") ||
    msg.includes("insufficient balance") ||
    code === "INSUFFICIENT_FUNDS"
  ) {
    return ErrorKind.INSUFFICIENT_FUNDS;
  }
  if (msg.includes("nonce too low") || msg.includes("nonce has already been used") || code === "NONCE_EXPIRED") {
    return ErrorKind.NONCE;
  }
  // NOT_ELIGIBLE harus diperiksa SEBELUM NOT_LIVE. Pesan seperti
  // "wallet not eligible for this stage" mengandung "stage" dan "not", jadi
  // kalau NOT_LIVE didahulukan, pesan itu salah diklasifikasi sebagai
  // "belum buka" dan akan di-retry terus padahal wallet-nya memang tidak
  // masuk allowlist.
  if (msg.includes("not eligible") || msg.includes("not allowlisted") || msg.includes("no allowlist")) {
    return ErrorKind.NOT_ELIGIBLE;
  }
  if (
    msg.includes("dropnotminting") ||
    msg.includes("not live") ||
    msg.includes("not started") ||
    (msg.includes("stage") && msg.includes("not"))
  ) {
    return ErrorKind.NOT_LIVE;
  }
  if (msg.includes("sold out") || msg.includes("max supply") || msg.includes("exceeds supply")) {
    return ErrorKind.SOLD_OUT;
  }
  if (
    msg.includes("execution reverted") ||
    msg.includes("would revert") ||
    code === "CALL_EXCEPTION"
  ) {
    return ErrorKind.WOULD_REVERT;
  }
  if (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("socket hang up") ||
    msg.includes("network error") ||
    msg.includes("fetch failed") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    code === "NETWORK_ERROR" ||
    code === "SERVER_ERROR" ||
    code === "TIMEOUT"
  ) {
    return ErrorKind.RPC_DOWN;
  }
  // Ambigu: tx sudah dikirim tapi konfirmasinya tidak terbaca. Ini yang paling
  // berbahaya untuk diulang.
  if (
    msg.includes("transaction was replaced") ||
    msg.includes("already known") ||
    msg.includes("transaction underpriced") && msg.includes("known")
  ) {
    return ErrorKind.TX_SENT_UNKNOWN;
  }

  return ErrorKind.UNKNOWN;
}

/**
 * Backoff eksponensial + jitter.
 *
 * Jitter penting: kalau 10 wallet kena rate limit di detik yang sama dan
 * semuanya menunggu tepat 1000ms, mereka akan menabrak limit lagi bersamaan.
 * Jitter memecah gelombang itu.
 */
export function backoffMs(attempt, { base = 400, max = 8000 } = {}) {
  const exp = Math.min(base * 2 ** (attempt - 1), max);
  return Math.round(exp * (0.5 + Math.random() * 0.5));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Jalankan `fn` dengan auto-retry.
 *
 * fn menerima ({ attempt, switchRpc }) dan boleh melempar error.
 * onEvent dipanggil tiap percobaan supaya bisa dicatat ke log/DB.
 */
export async function withRetry(fn, opts = {}) {
  const {
    maxAttempts = 3,
    onEvent = null,
    // Batas waktu total: kalau mint window pendek, tidak ada gunanya terus
    // mencoba sampai kehabisan percobaan.
    deadlineMs = null,
    label = "",
  } = opts;

  const startedAt = Date.now();
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (deadlineMs && Date.now() - startedAt > deadlineMs) {
      await onEvent?.({ type: "deadline", attempt, label });
      break;
    }

    try {
      const result = await fn({ attempt });
      if (attempt > 1) {
        await onEvent?.({ type: "recovered", attempt, label });
      }
      return result;
    } catch (err) {
      lastError = err;
      const kind = classifyError(err);
      const traits = traitsOf(kind);

      await onEvent?.({
        type: "error",
        attempt,
        kind,
        traits,
        message: err?.message ?? String(err),
        label,
      });

      // Jangan pernah ulangi otomatis kalau tx mungkin sudah terkirim.
      if (traits.unsafeToRetry) {
        err.errorKind = kind;
        err.unsafeToRetry = true;
        throw err;
      }

      if (traits.fatal || attempt >= maxAttempts) {
        err.errorKind = kind;
        throw err;
      }

      const wait = kind === ErrorKind.RATE_LIMIT
        ? backoffMs(attempt, { base: 1500, max: 15000 })
        : backoffMs(attempt);

      await onEvent?.({ type: "waiting", attempt, kind, waitMs: wait, label });
      await sleep(wait);
    }
  }

  if (lastError) {
    lastError.errorKind = classifyError(lastError);
    throw lastError;
  }
  throw new Error(`withRetry(${label}): gagal tanpa error tercatat`);
}
