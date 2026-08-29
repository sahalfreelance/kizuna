import { ethers } from "ethers";
import { acquire, isCoolingDown } from "./rateLimiter.js";
import { classifyError, ErrorKind } from "./retry.js";

/**
 * Pool RPC dengan failover.
 *
 * Masalah yang dipecahkan: satu RPC mati/lambat/rate-limit di detik-detik
 * mint = job gagal total. Padahal biasanya ada RPC lain yang sehat.
 *
 * Cara kerja:
 *   - Daftar RPC diurut prioritas (RPC user dulu, lalu default publik)
 *   - `call()` mencoba RPC teratas yang sehat; kalau gagal karena RPC
 *     (timeout/429/5xx), pindah ke berikutnya dan ULANGI operasi yang sama
 *   - RPC yang gagal ditandai "sakit" selama beberapa detik supaya tidak
 *     dicoba terus-menerus
 *   - Error yang BUKAN masalah RPC (revert, insufficient funds) TIDAK memicu
 *     failover — pindah RPC tidak akan mengubah hasilnya
 *
 * PENTING: `call()` hanya untuk operasi yang aman diulang (read, estimate,
 * getNonce). Untuk mengirim transaksi ada `sendOnce()` yang TIDAK failover,
 * karena mengulang pengiriman berisiko tx dobel.
 */

const SICK_MS = 15000;

export class RpcPool {
  /**
   * @param entries [{ url, host, source }] urut prioritas
   * @param chainId untuk memverifikasi RPC benar-benar chain yang dimaksud
   */
  constructor(entries, chainId, { log = null } = {}) {
    this.chainId = chainId;
    this.log = log;
    this.entries = entries.map((e) => ({
      url: e.url,
      host: e.host || hostOf(e.url),
      source: e.source || "unknown",
      provider: null,
      verified: false,
      sickUntil: 0,
      failCount: 0,
      okCount: 0,
      lastError: null,
    }));
  }

  get size() {
    return this.entries.length;
  }

  healthy() {
    const now = Date.now();
    return this.entries.filter((e) => e.sickUntil <= now);
  }

  /** Buat provider kalau belum ada, dan verifikasi chain id sekali. */
  async providerFor(entry) {
    if (!entry.provider) {
      entry.provider = entry.url.startsWith("ws")
        ? new ethers.WebSocketProvider(entry.url)
        : new ethers.JsonRpcProvider(entry.url, undefined, {
            // staticNetwork: hindari ethers memanggil eth_chainId berulang
            // sebelum tiap request — itu menggandakan latensi.
            staticNetwork: true,
          });
    }

    if (!entry.verified) {
      const net = await entry.provider.getNetwork();
      if (Number(net.chainId) !== Number(this.chainId)) {
        // Ini bukan masalah sementara: RPC-nya memang chain yang salah.
        // Tandai sakit lama supaya tidak dipakai lagi di job ini.
        entry.sickUntil = Date.now() + 3600000;
        throw new Error(
          `RPC ${entry.host} menunjuk chain id ${net.chainId}, seharusnya ${this.chainId}`
        );
      }
      entry.verified = true;
    }

    return entry.provider;
  }

  markSick(entry, err) {
    entry.sickUntil = Date.now() + SICK_MS;
    entry.failCount++;
    entry.lastError = String(err?.message ?? err).slice(0, 200);
  }

  markOk(entry) {
    entry.okCount++;
    // Pulih lebih cepat kalau sebelumnya sakit.
    entry.sickUntil = 0;
  }

  /**
   * Jalankan `fn(provider, entry)` pada RPC pertama yang sehat, failover ke
   * berikutnya saat error yang berkaitan dengan RPC.
   *
   * HANYA untuk operasi yang aman diulang.
   */
  async call(fn, { label = "rpc" } = {}) {
    const now = Date.now();

    // Semua sakit? Pakai yang paling cepat pulih daripada gagal total.
    let candidates = this.entries.filter((e) => e.sickUntil <= now);
    if (candidates.length === 0) {
      candidates = [...this.entries].sort((a, b) => a.sickUntil - b.sickUntil).slice(0, 1);
      await this.log?.warn?.(
        `Semua RPC bermasalah, memaksa pakai ${candidates[0].host}`
      );
    }

    let lastErr = null;

    for (const entry of candidates) {
      // Hormati cooldown rate limit host ini.
      if (isCoolingDown(entry.url) && candidates.length > 1) {
        continue;
      }

      try {
        await acquire(entry.url);
        const provider = await this.providerFor(entry);
        const result = await fn(provider, entry);
        this.markOk(entry);
        return { result, entry };
      } catch (err) {
        lastErr = err;
        const kind = classifyError(err);

        // Error yang bukan soal RPC: pindah provider tidak menolong.
        const rpcProblem =
          kind === ErrorKind.RPC_DOWN ||
          kind === ErrorKind.RATE_LIMIT ||
          String(err?.message || "").includes("menunjuk chain id");

        if (!rpcProblem) {
          throw err;
        }

        this.markSick(entry, err);
        await this.log?.warn?.(
          `RPC ${entry.host} gagal (${kind}) pada ${label}, coba RPC lain`
        );
      }
    }

    const err = lastErr || new Error(`Semua RPC gagal untuk ${label}`);
    err.allRpcFailed = true;
    throw err;
  }

  /**
   * Kirim transaksi. TIDAK failover.
   *
   * Kalau pengiriman gagal dengan cara yang ambigu (mungkin sudah masuk
   * mempool), mengulangnya di RPC lain bisa menghasilkan DUA transaksi.
   * Jadi di sini sengaja hanya satu percobaan pada RPC yang sudah terbukti
   * sehat, dan errornya diteruskan apa adanya untuk diklasifikasi pemanggil.
   */
  async sendOnce(signerFactory, txRequest, { label = "sendTx" } = {}) {
    const now = Date.now();
    const entry =
      this.entries.find((e) => e.sickUntil <= now && e.verified) ||
      this.entries.find((e) => e.sickUntil <= now) ||
      this.entries[0];

    await acquire(entry.url);
    const provider = await this.providerFor(entry);
    const signer = signerFactory(provider);

    try {
      const tx = await signer.sendTransaction(txRequest);
      this.markOk(entry);
      return { tx, entry };
    } catch (err) {
      // Jangan tandai sakit untuk error yang bukan soal RPC — misalnya revert
      // atau insufficient funds; RPC-nya sendiri sehat.
      const kind = classifyError(err);
      if (kind === ErrorKind.RPC_DOWN || kind === ErrorKind.RATE_LIMIT) {
        this.markSick(entry, err);
      }
      err.rpcHost = entry.host;
      throw err;
    }
  }

  async destroy() {
    for (const e of this.entries) {
      try {
        await e.provider?.destroy?.();
      } catch {
        /* abaikan */
      }
      e.provider = null;
    }
  }

  summary() {
    return this.entries.map((e) => ({
      host: e.host,
      source: e.source,
      ok: e.okCount,
      fail: e.failCount,
      sick: e.sickUntil > Date.now(),
      lastError: e.lastError,
    }));
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}
