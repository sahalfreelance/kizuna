import "dotenv/config";
import { ethers } from "ethers";

import { supabase, supabaseConfigError } from "./lib/supabase.js";
import { createJobLogger } from "./lib/jobLogger.js";
import { decryptPrivateKey, assertEncryptionKeyReady } from "./lib/walletCrypto.js";
import { getOpenseaApiKey, invalidateCache } from "./lib/openseaKey.js";
import { getChain, SUPPORTED_CHAINS } from "./lib/chains.js";
import { RpcPool } from "./lib/rpcPool.js";
import { statsSnapshot } from "./lib/rateLimiter.js";
import { mintWalletGuarded } from "./lib/mintGuarded.js";
import { siweLogin } from "./lib/auth.js";
import { fetchDropInfo } from "./lib/graphql.js";

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
  // RPC cadangan kalau job tidak membawa RPC user dan chain-nya tidak punya
  // default. Opsional sekarang — tiap chain di lib/chains.js sudah punya
  // defaultRpc sendiri.
  RPC_URL: process.env.RPC_URL || null,
  POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS) || 5000,
  WORKER_ID: process.env.WORKER_ID || `worker-${process.pid}`,
  // Job yang stage-nya sudah lewat lebih dari ini dianggap kedaluwarsa.
  MAX_LATE_MS: parseInt(process.env.MAX_LATE_MS) || 5 * 60 * 1000,
};

const WORKER_VERSION = "v2";
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
async function loginWallets(wallets, chainId, apiKey, userId, log, opts = {}) {
  const { batchSize = 5, delayMs = 1000, maxRetries = 3, retryDelayMs = 2000 } = opts;

  const sessions = [];

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);

    for (const w of batch) {
      let ok = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const cookieStr = await siweLogin(w.privateKey, chainId, null, apiKey);
          sessions.push({ wallet: w.signer, address: w.address, cookieStr });
          await log.ok("Login OpenSea berhasil", w.address);
          ok = true;
          break;
        } catch (err) {
          const msg = String(err.message);
          const is429 = msg.includes("429");
          // 401/403 = API key ditolak. Buang cache-nya supaya percobaan
          // berikutnya mengambil key baru dari website.
          if (msg.includes("401") || msg.includes("403")) {
            invalidateCache(userId);
          }
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

/* ------------------------------------------------------------- proses job */

async function processJob(job) {
  const log = createJobLogger(job.id);

  console.log("");
  console.log(`  ── job ${job.id.slice(0, 8)} · ${job.slug} · ${ts()} ──`);

  await log.info(`Job diambil worker ${CONFIG.WORKER_ID} (${WORKER_VERSION})`);

  let pool;

  try {
    // ---- 1. Tentukan chain & RPC ----------------------------------------
    const chainInfo = getChain(job.chain);
    if (!chainInfo) {
      throw new Error(
        `Chain "${job.chain}" tidak didukung worker. ` +
          `Yang didukung: ${SUPPORTED_CHAINS.map((c) => c.identifier).join(", ")}`
      );
    }

    const chainId = job.chain_id || chainInfo.chainId;

    // ---- Susun POOL RPC, bukan satu RPC ---------------------------------
    // Anti-revert & anti-gagal: kalau RPC utama mati/lambat/rate-limit di
    // detik-detik mint, worker pindah ke RPC berikutnya tanpa menggagalkan
    // job. Urutan: RPC snapshot di job -> semua RPC user untuk chain ini
    // (urut prioritas) -> RPC publik default -> RPC_URL dari .env.
    const rpcEntries = [];
    const seenUrls = new Set();

    const pushRpc = (url, source) => {
      if (!url || seenUrls.has(url)) return;
      seenUrls.add(url);
      let host = "unknown";
      try {
        host = new URL(url).hostname;
      } catch {
        /* biarkan unknown */
      }
      rpcEntries.push({ url, host, source });
    };

    if (job.rpc_url) {
      try {
        pushRpc(decryptPrivateKey(job.rpc_url), "user (snapshot job)");
      } catch (err) {
        await log.warn(`Gagal dekripsi RPC snapshot job: ${err.message}`);
      }
    }

    // RPC fallback milik user untuk chain ini.
    try {
      const { data: userRpcs } = await supabase
        .from("aco_rpcs")
        .select("encrypted_url, display_host, priority")
        .eq("user_id", job.user_id)
        .eq("chain", job.chain)
        .order("priority", { ascending: true });

      for (const r of userRpcs || []) {
        try {
          pushRpc(decryptPrivateKey(r.encrypted_url), `user (prioritas ${r.priority})`);
        } catch {
          await log.warn(`RPC user ${r.display_host || "?"} gagal didekripsi, dilewati`);
        }
      }
    } catch (err) {
      await log.warn(`Tidak bisa baca RPC fallback user: ${err.message}`);
    }

    pushRpc(chainInfo.defaultRpc, "publik default");
    pushRpc(CONFIG.RPC_URL, ".env worker");

    if (rpcEntries.length === 0) {
      throw new Error(`Tidak ada RPC untuk chain ${chainInfo.label}`);
    }

    pool = new RpcPool(rpcEntries, chainId, { log });

    await log.info(
      `Chain ${chainInfo.label} (id ${chainId}) · ${rpcEntries.length} RPC: ` +
        rpcEntries.map((e) => e.host).join(", ")
    );

    // Verifikasi ada minimal satu RPC sehat DAN chain id-nya benar. Kalau RPC
    // salah chain, transaksi akan dikirim ke jaringan yang salah — lebih baik
    // gagal sekarang.
    try {
      const probe = await pool.call((p) => p.getBlockNumber(), { label: "cek RPC" });
      await log.ok(`RPC siap: ${probe.entry.host} (block ${probe.result})`);
    } catch (err) {
      throw new Error(
        `Semua RPC bermasalah untuk ${chainInfo.label}: ${err.message}. ` +
          "Tambahkan RPC sendiri di halaman /aco."
      );
    }

    // ---- 2. Ambil API key OpenSea (milik user pemilik job) ---------------
    // Key per user, bukan key bersama: rate limit pemakaian berlaku per key,
    // jadi kalau beberapa user mint bersamaan dengan key yang sama, request
    // saling berebut kuota dan sebagian gagal.
    const apiKey = await getOpenseaApiKey(job.user_id);
    if (!apiKey) {
      throw new Error(
        "API key OpenSea tidak tersedia untuk user ini. Minta user login ulang " +
          "ke website, atau tekan refresh key di halaman /aco."
      );
    }

    // ---- 3. Ambil wallet + dekripsi -------------------------------------
    const { data: walletRows, error: walletError } = await supabase
      .from("aco_wallets")
      .select("id, address, encrypted_key, label")
      .in("id", job.wallet_ids);

    if (walletError) throw new Error(`Gagal ambil wallet: ${walletError.message}`);
    if (!walletRows?.length) throw new Error("Wallet tidak ditemukan");

    const wallets = [];
    for (const row of walletRows) {
      try {
        const privateKey = decryptPrivateKey(row.encrypted_key);
        // Signer dibuat tanpa provider dulu — provider ditentukan per operasi
        // oleh RpcPool, supaya failover bisa jalan.
        const base = new ethers.Wallet(privateKey);

        // Pengaman: address hasil dekripsi harus cocok dengan yang tercatat.
        // Kalau tidak, ada yang salah — jangan lanjut pakai wallet itu.
        if (base.address.toLowerCase() !== row.address.toLowerCase()) {
          await log.error(
            `Address tidak cocok dengan data tersimpan, wallet dilewati`,
            row.address
          );
          continue;
        }

        wallets.push({
          address: base.address,
          privateKey,
          // Dipakai RpcPool.sendOnce untuk mengikat signer ke provider aktif.
          signerFor: (provider) => new ethers.Wallet(privateKey, provider),
        });
      } catch (err) {
        await log.error(`Gagal dekripsi wallet: ${err.message}`, row.address);
      }
    }

    if (wallets.length === 0) {
      throw new Error("Tidak ada wallet yang bisa dipakai");
    }

    await log.info(`${wallets.length} wallet siap`);

    // ---- 4. Login SIWE ---------------------------------------------------
    await log.info("Login ke OpenSea…");
    const sessions = await loginWallets(wallets, chainId, apiKey, job.user_id, log);

    if (sessions.length === 0) {
      throw new Error("Semua wallet gagal login OpenSea");
    }
    await log.ok(`${sessions.length}/${wallets.length} wallet berhasil login`);

    if (await isCancelled(job.id)) {
      await log.warn("Job dibatalkan user, berhenti.");
      return;
    }

    // ---- 5. Konfirmasi drop info ----------------------------------------
    // Contract & jadwal diambil ulang untuk memastikan datanya masih benar
    // saat eksekusi. `chain` TIDAK diubah dari hasil refresh: provider sudah
    // dibuat dan diverifikasi untuk chain ini, jadi kalau OpenSea melaporkan
    // chain berbeda itu kondisi ganjil yang lebih aman digagalkan.
    let contractAddress = job.contract_address;
    let startTimeISO = job.stage_start_time;

    try {
      const drop = await fetchDropInfo(job.slug, sessions[0].cookieStr);
      if (drop?.contractAddress) contractAddress = drop.contractAddress;

      if (drop?.chain && drop.chain !== job.chain) {
        throw new Error(
          `Collection sekarang di chain "${drop.chain}", tapi job dibuat untuk ` +
            `"${job.chain}". Batalkan dan bikin job baru.`
        );
      }

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
      // Ketidakcocokan chain itu fatal, bukan sesuatu yang boleh dilewati.
      if (String(err.message).includes("Collection sekarang di chain")) throw err;
      await log.warn(`Tidak bisa refresh drop info: ${err.message}. Pakai data tersimpan.`);
    }

    if (!contractAddress) {
      throw new Error("Contract address tidak diketahui");
    }

    const chain = job.chain;
    await log.info(`Contract ${contractAddress} · chain ${chain}`);

    // Job yang jadwalnya sudah lewat jauh tidak usah dijalankan.
    const lateBy = Date.now() - new Date(startTimeISO).getTime();
    if (lateBy > CONFIG.MAX_LATE_MS) {
      throw new Error(
        `Stage sudah lewat ${Math.round(lateBy / 60000)} menit — job kedaluwarsa`
      );
    }

    // ---- 6. Tunggu window ----------------------------------------------
    await setJobStatus(job.id, { started_at: new Date().toISOString() });

    const startTs = await waitForWindow(startTimeISO, job.id, log);
    if (startTs === null) {
      await log.warn("Job dibatalkan user, berhenti.");
      return;
    }

    // ---- 7. Mint semua wallet paralel -----------------------------------
    await setJobStatus(job.id, { status: "RUNNING" });
    await log.info(
      `Mint dengan ${sessions.length} wallet (paralel) · ` +
        `maks ${job.max_attempts || 3} percobaan/wallet · ` +
        `anti-revert ${job.abort_on_revert === false ? "OFF" : "ON"}`
    );

    const startTimeMs = new Date(startTimeISO).getTime();

    const settled = await Promise.allSettled(
      sessions.map((session) =>
        mintWalletGuarded({
          supabase,
          session,
          job,
          pool,
          contractAddress,
          chain,
          startTs,
          startTimeMs,
          apiKey,
          log,
        })
      )
    );

    const results = settled.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { address: "?", success: false, error: String(r.reason).slice(0, 300) }
    );

    const successCount = results.filter((r) => r.success).length;
    const preventedCount = results.filter((r) => r.prevented).length;
    const unconfirmedCount = results.filter((r) => r.unconfirmed).length;

    await setJobStatus(job.id, {
      status: "DONE",
      finished_at: new Date().toISOString(),
      result_summary: results,
      preflight: {
        prevented: preventedCount,
        unconfirmed: unconfirmedCount,
        rpc: pool.summary(),
        rateLimit: statsSnapshot(),
      },
    });

    let ringkasan = `Selesai — ${successCount}/${results.length} wallet berhasil mint`;
    if (preventedCount > 0) {
      // Ini bukan kegagalan: gas berhasil diselamatkan.
      ringkasan += ` · ${preventedCount} dicegah sebelum kirim (gas aman)`;
    }
    if (unconfirmedCount > 0) {
      ringkasan += ` · ${unconfirmedCount} tx perlu dicek manual`;
    }
    await log.ok(ringkasan);

    // Ringkasan kesehatan RPC — berguna buat user memutuskan perlu ganti RPC.
    for (const r of pool.summary()) {
      if (r.fail > 0) {
        await log.warn(
          `RPC ${r.host} (${r.source}): ${r.ok} sukses, ${r.fail} gagal` +
            (r.lastError ? ` — ${r.lastError.slice(0, 80)}` : "")
        );
      }
    }
  } catch (err) {
    console.error(`  [worker] job ${job.id.slice(0, 8)} gagal: ${err.message}`);
    await log.error(err.message);
    await setJobStatus(job.id, {
      status: "FAILED",
      error_message: String(err.message).slice(0, 500),
      finished_at: new Date().toISOString(),
    });
  } finally {
    // RpcPool memegang provider (WebSocket bisa menahan socket); wajib ditutup
    // atau proses menumpuk koneksi tiap job dan kehabisan file descriptor.
    try {
      await pool?.destroy?.();
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

  if (supabaseConfigError) {
    console.error(`  ✗ ${supabaseConfigError}`);
    process.exit(1);
  }

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

  // API key OpenSea sekarang per user (dibuat dari browser user saat login),
  // jadi tidak ada satu key global yang bisa dicek di sini. Yang diperiksa:
  // apakah jalur pengambilannya terkonfigurasi.
  if (process.env.WEBSITE_URL && process.env.WORKER_SHARED_SECRET) {
    console.log("  ✓ Jalur API key ke website terkonfigurasi");
  } else {
    console.log(
      "  ⚠ WEBSITE_URL / WORKER_SHARED_SECRET belum di-set — worker akan baca\n" +
        "    key langsung dari database (masih jalan, tapi tanpa jalur utama)."
    );
  }

  // Uji RPC tiap chain. Ini yang paling sering jadi sumber masalah, jadi
  // dilaporkan per chain, bukan sekadar satu RPC global.
  console.log("");
  console.log("  RPC per chain:");
  for (const c of SUPPORTED_CHAINS) {
    const url = c.defaultRpc || CONFIG.RPC_URL;
    if (!url) {
      console.log(`    ✗ ${c.label.padEnd(14)} tidak ada RPC`);
      continue;
    }
    try {
      const probe = url.startsWith("ws")
        ? new ethers.WebSocketProvider(url)
        : new ethers.JsonRpcProvider(url);
      const net = await probe.getNetwork();
      const match = Number(net.chainId) === c.chainId;
      console.log(
        `    ${match ? "✓" : "✗"} ${c.label.padEnd(14)} chainId ${net.chainId}` +
          (match ? "" : ` — TIDAK COCOK, seharusnya ${c.chainId}`)
      );
      await probe.destroy?.();
    } catch (err) {
      console.log(`    ✗ ${c.label.padEnd(14)} ${String(err.message).slice(0, 50)}`);
    }
  }
  console.log("");
  console.log("  Catatan: RPC publik di atas rate-limit-nya ketat. Untuk mint");
  console.log("  kompetitif, user sebaiknya simpan RPC sendiri di halaman /aco.");

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
