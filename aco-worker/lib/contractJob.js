/**
 * Jalur job platform "contract": mint langsung ke kontrak.
 *
 * Dipisah dari alur OpenSea di worker.js karena tidak ada API marketplace di
 * sini — tidak ada login SIWE, tidak ada API key, tidak ada refresh drop info.
 * Yang ada: ABI diambil otomatis, calldata disusun sendiri, dan SETIAP calldata
 * wajib lolos `eth_call` sebelum tx dikirim.
 *
 * Dependensi disuntik lewat `deps` supaya file ini tidak perlu mengimpor
 * worker.js (yang akan jadi lingkaran impor).
 */

import { prepareContractMint, executeContractMint } from "./contractMintRunner.js";
import { withWalletLock } from "./walletLock.js";

/**
 * @param job         baris aco_jobs
 * @param wallets     [{ id, address, privateKey }]
 * @param rpcUrl      RPC aktif untuk chain job
 * @param log         jobLogger
 * @param deps        { setJobStatus, isCancelled, waitForWindow, mintSemaphore }
 */
export async function runContractJob({ job, wallets, rpcUrl, log, deps }) {
  const { setJobStatus, isCancelled, waitForWindow, mintSemaphore } = deps;
  const address = job.contract_address;

  if (!address) {
    throw new Error("Job contract tanpa contract_address — tidak bisa dijalankan.");
  }

  // ---- 1. Analisa kontrak SEBELUM window buka --------------------------
  // Sengaja di sini, bukan di detik-J: ambil ABI + baca state butuh ~1-3s.
  await log.info(`Menganalisa kontrak ${address}…`);

  const prepared = await prepareContractMint({
    address,
    chain: job.chain,
    rpcUrl,
    etherscanKey: process.env.ETHERSCAN_API_KEY || null,
  });

  const publicFns = prepared.candidates.filter((f) => !f.ownerOnly);

  await log.info(
    `ABI: ${prepared.abiSource}` +
      (prepared.verified ? " (verified)" : " (tidak verified, direkonstruksi)") +
      ` · ${publicFns.length} fungsi mint kandidat: ${publicFns.map((f) => f.signature).join(", ")}`
  );

  await log.info(
    `Mode: ${prepared.mode.mode} — ${prepared.mode.reason}` +
      (prepared.priceWei != null ? ` · harga ${prepared.priceWei} wei` : "")
  );

  if (prepared.state.totalSupply != null && prepared.state.MAX_SUPPLY != null) {
    await log.info(`Supply: ${prepared.state.totalSupply}/${prepared.state.MAX_SUPPLY}`);
  }

  if (prepared.mode.mode === "WHITELIST" && !job.platform_config?.proof) {
    // Bukan alasan menggagalkan job: banyak kontrak WL memakai mapping
    // on-chain, bukan merkle proof. Simulasi yang akan memutuskan.
    await log.warn(
      "Kontrak ini berbasis whitelist dan tidak ada merkle proof di job. " +
        "Kalau whitelist-nya pakai merkle, mint akan ditolak simulasi."
    );
  }

  if (prepared.mode.gated) {
    await log.info("Mint belum dibuka di kontrak — simulasi akan diulang sampai terbuka.");
  }

  if (await isCancelled(job.id)) {
    await log.warn("Job dibatalkan user, berhenti.");
    return;
  }

  // ---- 2. Tunggu window kalau user menjadwalkan ------------------------
  await setJobStatus(job.id, { started_at: new Date().toISOString() });

  if (job.stage_start_time) {
    const startMs = new Date(job.stage_start_time).getTime();
    if (startMs > Date.now()) {
      const ok = await waitForWindow(job.stage_start_time, job.id, log);
      if (ok === null) {
        await log.warn("Job dibatalkan user, berhenti.");
        return;
      }
    } else {
      await log.info("Waktu mulai sudah lewat — langsung mint.");
    }
  } else {
    // Tanpa jadwal: langsung hammer simulasi. Untuk FCFS yang belum buka, ini
    // yang menangkap detik pembukaan.
    await log.info("Tanpa jadwal — langsung hammer simulasi sampai mint terbuka.");
  }

  // ---- 3. Fase mint (dibatasi semaphore, sama seperti OpenSea) ---------
  await setJobStatus(job.id, { status: "RUNNING" });

  // Tiap percobaan simulasi = 1 eth_call + jeda 200ms. max_attempts dikalikan
  // 100 karena "percobaan" di UI berarti percobaan MINT, sedangkan di sini yang
  // diulang adalah simulasi menunggu window terbuka.
  const maxSim = Math.max(
    1,
    Math.min(
      parseInt(job.platform_config?.maxSimAttempts, 10) ||
        parseInt(job.max_attempts, 10) * 100 ||
        300,
      3000
    )
  );

  const settled = await mintSemaphore.run(async () => {
    await log.info(
      `Mint ${wallets.length} wallet paralel · maks ${maxSim} percobaan simulasi/wallet`
    );

    return Promise.allSettled(
      wallets.map((w) =>
        // Kunci per wallet: satu wallet tidak boleh mengirim 2 tx bersamaan,
        // nonce-nya bisa tabrakan dan salah satu tx tertimpa.
        withWalletLock(w.address, async () => {
          try {
            const r = await executeContractMint({
              privateKey: w.privateKey,
              address,
              rpcUrl,
              prepared,
              quantity: job.mint_amount || 1,
              proof: job.platform_config?.proof || null,
              tokenIds: job.platform_config?.tokenIds || null,
              manual: job.platform_config?.manual || null,
              gasLimit: job.gas_limit || null,
              maxSimAttempts: maxSim,
              onLog: (m) => log.info(m, w.address),
            });
            await log.ok(`Mint terkirim: ${r.txHash} (${r.fn})`, w.address);
            return { address: w.address, success: true, ...r };
          } catch (e) {
            // Simulasi tidak pernah lolos = tidak ada tx dikirim = gas aman.
            await log.warn(`Tidak mint: ${e.message.split("\n")[0]}`, w.address);
            return {
              address: w.address,
              success: false,
              prevented: true,
              error: String(e.message).slice(0, 300),
            };
          }
        })
      )
    );
  });

  const results = settled.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { address: "?", success: false, error: String(r.reason).slice(0, 300) }
  );

  const successCount = results.filter((r) => r.success).length;
  const preventedCount = results.filter((r) => r.prevented).length;

  await setJobStatus(job.id, {
    status: "DONE",
    finished_at: new Date().toISOString(),
    result_summary: results,
    preflight: {
      prevented: preventedCount,
      abiSource: prepared.abiSource,
      verified: prepared.verified,
      mode: prepared.mode.mode,
      mintFunction: publicFns[0]?.signature || null,
    },
  });

  let ringkasan = `Selesai — ${successCount}/${results.length} wallet mengirim tx`;
  if (preventedCount > 0) {
    ringkasan += ` · ${preventedCount} dicegah sebelum kirim (gas aman)`;
  }
  await log.ok(ringkasan);
}
