import "dotenv/config";
import { ethers } from "ethers";

import { supabase, supabaseConfigError } from "./lib/supabase.js";
import { createJobLogger } from "./lib/jobLogger.js";
import { decryptPrivateKey, assertEncryptionKeyReady } from "./lib/walletCrypto.js";
import { siweLogin, hasOpenseaApiKey } from "./lib/auth.js";
import { fetchDropInfo, fetchCalldataWithRetry } from "./lib/graphql.js";
import { prefetchNonce, sendMintTx, waitForMintStatus } from "./lib/mint.js";

/**
 * ACO Worker — eksekutor job mint dari website Kizuna.
 *
 * Alur:
 *   1. Polling tabel aco_jobs cari status QUEUED
 *   2. Claim job (atomic, biar dua worker tidak mengambil job yang sama)
 *   3. Dekripsi wallet -> login SIWE -> tunggu mint window -> mint
 *   4. Tulis progres ke aco_logs, hasil akhir ke aco_jobs.result_summary
 *
 * lib/auth.js, lib/graphql.js, lib/mint.js DIPAKAI APA ADANYA dari script CLI
 * yang sudah jalan — tidak diubah, supaya perilaku mint-nya identik.
 *
 * Private key: didekripsi di memori saja, tidak pernah ditulis ke log/DB.
 */

const CONFIG = {
  RPC_URL: process.env.RPC_URL,
  CHAIN_ID: parseInt(process.env.CHAIN_ID) || 1,
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS) || 5000,
  WORKER_ID: process.env.WORKER_ID || `worker-${process.pid}`,
  // Job yang stage-nya sudah lewat lebih dari ini dianggap kedaluwarsa.
  MAX_LATE_MS: parseInt(process.env.MAX_LATE_MS) || 5 * 60 * 1000,
};

const WORKER_VERSION = "v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

/* ----------------------------------------------------------------- helpers */

async function setJobStatus(jobId, patch) {
  const { error } = await supabase
    .from("aco_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId);

  if (error) {
    console.error(`  [worker] gagal update job ${jobId}: ${error.message}`);
  }
}

/** Cek apakah job dibatalkan user di tengah jalan. */
async function isCancelled(jobId) {
  const { data } = await supabase
    .from("aco_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();
  return data?.status === "CANCELLED";
}

/**
 * Ambil satu job QUEUED dan klaim secara atomic.
 *
 * Kunci anti-race: UPDATE difilter `.eq("status", "QUEUED")`. Kalau ada worker
 * lain yang menang lebih dulu, statusnya sudah bukan QUEUED sehingga update
 * ini tidak mengenai baris apa pun dan `data` jadi null.
 */
async function claimNextJob() {
  const { data: candidates, error } = await supabase
    .from("aco_jobs")
    .select("*")
    .eq("status", "QUEUED")
    .order("created_at", { ascending: true })
    .limit(5);

  if (error) {
    console.error(`  [worker] gagal polling: ${error.message}`);
    return null;
  }
  if (!candidates || candidates.length === 0) return null;

  for (const candidate of candidates) {
    const { data: claimed } = await supabase
      .from("aco_jobs")
      .update({
        status: "CLAIMED",
        claimed_by: CONFIG.WORKER_ID,
        claimed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidate.id)
      .eq("status", "QUEUED")
      .select("*")
      .maybeSingle();

    if (claimed) return claimed;
  }

  return null;
}

/** Bebaskan job yang nyangkut karena worker mati di tengah jalan. */
async function releaseStuckJobs() {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data } = await supabase
    .from("aco_jobs")
    .update({
      status: "FAILED",
      error_message: "Worker berhenti di tengah jalan (job nyangkut > 30 menit)",
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in("status", ["CLAIMED", "RUNNING"])
    .lt("claimed_at", cutoff)
    .select("id");

  if (data?.length) {
    console.log(`  [worker] ${data.length} job nyangkut dibebaskan`);
  }
}

/* -------------------------------------------------------------- login batch */

/**
 * Login SIWE semua wallet, batch + retry.
 *
 * Logika retry-nya mengikuti script CLI: OpenSea rate-limit (429) cukup sering
 * kalau banyak wallet login berbarengan, jadi diproses sequential dengan jeda
 * antar batch.
 */
async function loginWallets(wallets, log, opts = {}) {
  const { batchSize = 5, delayMs = 1000, maxRetries = 3, retryDelayMs = 2000 } = opts;

  const sessions = [];

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);

    for (const w of batch) {
      let ok = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const cookieStr = await siweLogin(w.privateKey, CONFIG.CHAIN_ID);
          sessions.push({ wallet: w.signer, address: w.address, cookieStr });
          await log.ok("Login OpenSea berhasil", w.address);
          ok = true;
          break;
        } catch (err) {
          const is429 = String(err.message).includes("429");
          if (is429 && attempt < maxRetries) {
            await log.warn(
              `Rate limited, coba lagi (${attempt}/${maxRetries})`,
              w.address
            );
            await sleep(retryDelayMs * attempt);
            continue;
          }
          await log.error(`Login gagal: ${err.message}`, w.address);
          break;
        }
      }

      if (!ok) continue;
    }

    if (i + batchSize < wallets.length) await sleep(delayMs);
  }

  return sessions;
}

/* ---------------------------------------------------------- tunggu window */

/**
 * Tunggu sampai mendekati waktu mint. Berhenti 10 detik sebelum jadwal —
 * sisanya ditangani `fetchCalldataWithRetry` yang mulai hammer 1.5 detik
 * sebelum window buka.
 *
 * Selama menunggu, status pembatalan dicek berkala supaya job yang
 * dibatalkan user tidak tetap jalan.
 */
async function waitForWindow(startTimeISO, jobId, log) {
  const startTs = Math.floor(new Date(startTimeISO).getTime() / 1000);

  while (true) {
    if (await isCancelled(jobId)) return null;

    const now = Math.floor(Date.now() / 1000);
    const remaining = startTs - now;

    if (remaining <= 10) {
      await log.info(`Mint window hampir buka (${remaining}s), pemanasan…`);
      return startTs;
    }

    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const label = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    if (remaining > 120) {
      await log.info(`Menunggu — ${label} lagi`);
      await sleep(60000);
    } else if (remaining > 30) {
      await log.info(`Menunggu — ${label} lagi`);
      await sleep(10000);
    } else {
      await sleep(3000);
    }
  }
}

/* ------------------------------------------------------------ mint 1 wallet */

async function mintOne({ session, job, contractAddress, chain, startTs, log }) {
  const { wallet, address, cookieStr } = session;

  try {
    const cachedNonce = await prefetchNonce(wallet);

    const calldataResults = await fetchCalldataWithRetry(
      [{ address, cookieStr }],
      contractAddress,
      chain,
      cookieStr,
      {
        startTime: startTs,
        maxRetries: 300,
        retryDelayMs: 200,
        quantity: String(job.mint_amount),
      }
    );

    if (!calldataResults || calldataResults.length === 0) {
      throw new Error("Tidak dapat calldata — wallet mungkin tidak eligible");
    }

    const calldata = calldataResults[0];
    await log.ok(`Calldata siap → ${calldata.to}`, address);

    const tx = await sendMintTx(wallet, calldata, {
      cachedNonce,
      gasLimit: job.gas_limit,
    });
    await log.ok(`Tx dikirim: ${tx.hash}`, address);

    const receipt = await waitForMintStatus(
      tx.hash,
      contractAddress,
      chain,
      job.price_unit || "0",
      cookieStr
    );

    const success = receipt?.status === "SUCCESS";
    if (success) {
      await log.ok(`Mint SUKSES · tx ${tx.hash}`, address);
    } else {
      await log.error(`Mint gagal menurut OpenSea (${receipt?.status})`, address);
    }

    return { address, success, txHash: tx.hash };
  } catch (err) {
    await log.error(`Error: ${err.message}`, address);
    return { address, success: false, error: String(err.message).slice(0, 300) };
  }
}

/* ------------------------------------------------------------- proses job */

async function processJob(job) {
  const log = createJobLogger(job.id);

  console.log("");
  console.log(`  ── job ${job.id.slice(0, 8)} · ${job.slug} · ${ts()} ──`);

  await log.info(`Job diambil worker ${CONFIG.WORKER_ID} (${WORKER_VERSION})`);

  let provider;

  try {
    // ---- 1. Ambil wallet + dekripsi -------------------------------------
    const { data: walletRows, error: walletError } = await supabase
      .from("aco_wallets")
      .select("id, address, encrypted_key, label")
      .in("id", job.wallet_ids);

    if (walletError) throw new Error(`Gagal ambil wallet: ${walletError.message}`);
    if (!walletRows?.length) throw new Error("Wallet tidak ditemukan");

    // JsonRpcProvider (HTTP) dipakai kalau RPC_URL bukan ws://. Script CLI
    // pakai WebSocketProvider; di worker yang hidup terus dua-duanya jalan,
    // jadi dipilih otomatis berdasarkan skema URL.
    provider = CONFIG.RPC_URL.startsWith("ws")
      ? new ethers.WebSocketProvider(CONFIG.RPC_URL)
      : new ethers.JsonRpcProvider(CONFIG.RPC_URL);

    const wallets = [];
    for (const row of walletRows) {
      try {
        const privateKey = decryptPrivateKey(row.encrypted_key);
        const signer = new ethers.Wallet(privateKey, provider);

        // Pengaman: address hasil dekripsi harus cocok dengan yang tercatat.
        // Kalau tidak, ada yang salah — jangan lanjut pakai wallet itu.
        if (signer.address.toLowerCase() !== row.address.toLowerCase()) {
          await log.error(
            `Address tidak cocok dengan data tersimpan, wallet dilewati`,
            row.address
          );
          continue;
        }

        wallets.push({ address: signer.address, privateKey, signer });
      } catch (err) {
        await log.error(`Gagal dekripsi wallet: ${err.message}`, row.address);
      }
    }

    if (wallets.length === 0) {
      throw new Error("Tidak ada wallet yang bisa dipakai");
    }

    await log.info(`${wallets.length} wallet siap`);

    // ---- 2. Login SIWE ---------------------------------------------------
    await log.info("Login ke OpenSea…");
    const sessions = await loginWallets(wallets, log);

    if (sessions.length === 0) {
      throw new Error("Semua wallet gagal login OpenSea");
    }
    await log.ok(`${sessions.length}/${wallets.length} wallet berhasil login`);

    if (await isCancelled(job.id)) {
      await log.warn("Job dibatalkan user, berhenti.");
      return;
    }

    // ---- 3. Konfirmasi drop info ----------------------------------------
    // Contract & chain sudah disimpan saat job dibuat, tapi diambil ulang
    // untuk memastikan datanya masih benar saat eksekusi.
    let contractAddress = job.contract_address;
    let chain = job.chain;
    let startTimeISO = job.stage_start_time;

    try {
      const drop = await fetchDropInfo(job.slug, sessions[0].cookieStr);
      if (drop?.contractAddress) contractAddress = drop.contractAddress;
      if (drop?.chain) chain = drop.chain;

      // Stage bisa bergeser jadwalnya. Cocokkan lewat stage_index kalau ada.
      const stage =
        drop?.stages?.find((s) => s.stageIndex === job.stage_index) ||
        drop?.stages?.[job.stage_index];

      if (stage?.startTime && stage.startTime !== startTimeISO) {
        await log.warn(
          `Jadwal stage berubah di OpenSea: ${startTimeISO} → ${stage.startTime}`
        );
        startTimeISO = stage.startTime;
      }
    } catch (err) {
      await log.warn(`Tidak bisa refresh drop info: ${err.message}. Pakai data tersimpan.`);
    }

    if (!contractAddress || !chain) {
      throw new Error("Contract address / chain tidak diketahui");
    }

    await log.info(`Contract ${contractAddress} · chain ${chain}`);

    // Job yang jadwalnya sudah lewat jauh tidak usah dijalankan.
    const lateBy = Date.now() - new Date(startTimeISO).getTime();
    if (lateBy > CONFIG.MAX_LATE_MS) {
      throw new Error(
        `Stage sudah lewat ${Math.round(lateBy / 60000)} menit — job kedaluwarsa`
      );
    }

    // ---- 4. Tunggu window ----------------------------------------------
    await setJobStatus(job.id, { started_at: new Date().toISOString() });

    const startTs = await waitForWindow(startTimeISO, job.id, log);
    if (startTs === null) {
      await log.warn("Job dibatalkan user, berhenti.");
      return;
    }

    // ---- 5. Mint semua wallet paralel -----------------------------------
    await setJobStatus(job.id, { status: "RUNNING" });
    await log.info(`Mint dengan ${sessions.length} wallet (paralel)…`);

    const settled = await Promise.allSettled(
      sessions.map((session) =>
        mintOne({ session, job, contractAddress, chain, startTs, log })
      )
    );

    const results = settled.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { address: "?", success: false, error: String(r.reason).slice(0, 300) }
    );

    const successCount = results.filter((r) => r.success).length;

    await setJobStatus(job.id, {
      status: "DONE",
      finished_at: new Date().toISOString(),
      result_summary: results,
    });

    await log.ok(`Selesai — ${successCount}/${results.length} wallet berhasil mint`);
  } catch (err) {
    console.error(`  [worker] job ${job.id.slice(0, 8)} gagal: ${err.message}`);
    await log.error(err.message);
    await setJobStatus(job.id, {
      status: "FAILED",
      error_message: String(err.message).slice(0, 500),
      finished_at: new Date().toISOString(),
    });
  } finally {
    // WebSocketProvider memegang koneksi; wajib ditutup atau proses menumpuk
    // socket tiap job dan akhirnya kehabisan file descriptor.
    try {
      await provider?.destroy?.();
    } catch {
      /* abaikan */
    }
  }
}

/* ------------------------------------------------------------------- main */

async function main() {
  const checkOnly = process.argv.includes("--check");

  console.log("");
  console.log("  ┌" + "─".repeat(58) + "┐");
  console.log("  │  Kizuna ACO Worker " + WORKER_VERSION.padEnd(38) + "│");
  console.log("  └" + "─".repeat(58) + "┘");

  if (!CONFIG.RPC_URL) {
    console.error("  ✗ RPC_URL belum di-set di aco-worker/.env");
    process.exit(1);
  }

  if (supabaseConfigError) {
    console.error(`  ✗ ${supabaseConfigError}`);
    process.exit(1);
  }

  if (!hasOpenseaApiKey()) {
    console.error("  ✗ OPENSEA_API_KEY belum di-set di aco-worker/.env");
    process.exit(1);
  }
  console.log("  ✓ OPENSEA_API_KEY ada");

  try {
    assertEncryptionKeyReady();
    console.log("  ✓ WALLET_ENCRYPTION_KEY valid");
  } catch (err) {
    console.error(`  ✗ ${err.message}`);
    process.exit(1);
  }

  // Uji koneksi DB sekarang, bukan nanti saat job pertama masuk.
  const { error: dbError } = await supabase
    .from("aco_jobs")
    .select("id", { count: "exact", head: true });

  if (dbError) {
    console.error(`  ✗ Supabase: ${dbError.message}`);
    console.error("    Sudah jalanin migration_add_aco.sql?");
    process.exit(1);
  }
  console.log("  ✓ Supabase tersambung");

  try {
    const probe = CONFIG.RPC_URL.startsWith("ws")
      ? new ethers.WebSocketProvider(CONFIG.RPC_URL)
      : new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    const net = await probe.getNetwork();
    console.log(`  ✓ RPC tersambung · chainId ${net.chainId}`);
    await probe.destroy?.();
  } catch (err) {
    console.error(`  ✗ RPC gagal: ${err.message}`);
    process.exit(1);
  }

  if (checkOnly) {
    console.log("");
    console.log("  Semua pemeriksaan lolos. Worker siap dijalankan.");
    console.log("");
    process.exit(0);
  }

  console.log(`  worker id : ${CONFIG.WORKER_ID}`);
  console.log(`  polling   : tiap ${CONFIG.POLL_INTERVAL_MS / 1000}s`);
  console.log("");

  await releaseStuckJobs();

  let idleTicks = 0;

  // Loop utama. Job diproses satu per satu (sequential) — mint butuh CPU dan
  // jaringan penuh, menjalankan dua job berbarengan justru saling melambatkan.
  while (true) {
    try {
      const job = await claimNextJob();

      if (job) {
        idleTicks = 0;
        await processJob(job);
      } else {
        idleTicks++;
        // Heartbeat tiap ~5 menit biar kelihatan worker masih hidup di pm2 logs
        if (idleTicks % Math.max(1, Math.floor(300000 / CONFIG.POLL_INTERVAL_MS)) === 0) {
          console.log(`  [${ts()}] idle, menunggu job…`);
          await releaseStuckJobs();
        }
        await sleep(CONFIG.POLL_INTERVAL_MS);
      }
    } catch (err) {
      // Loop tidak boleh mati karena satu error; kalau mati, semua job
      // berhenti diproses sampai ada yang menyadarinya.
      console.error(`  [worker] error di loop: ${err?.message ?? err}`);
      await sleep(CONFIG.POLL_INTERVAL_MS);
    }
  }
}

process.on("SIGTERM", () => {
  console.log("  [worker] SIGTERM, berhenti.");
  process.exit(0);
});
process.on("SIGINT", () => {
  console.log("  [worker] SIGINT, berhenti.");
  process.exit(0);
});

main().catch((err) => {
  console.error("  [worker] fatal:", err);
  process.exit(1);
});
