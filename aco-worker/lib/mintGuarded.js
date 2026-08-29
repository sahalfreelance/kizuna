/**
 * Mint satu wallet, dengan anti-revert + auto-retry + failover RPC.
 *
 * Alur per percobaan:
 *   1. Ambil calldata dari OpenSea (fetchCalldataWithRetry sudah punya
 *      hammer-loop sendiri untuk menunggu stage buka)
 *   2. PREFLIGHT — simulasi eth_call + cek saldo + estimasi gas.
 *      Kalau memperkirakan revert, tx TIDAK dikirim: gas tidak terbuang.
 *   3. Kirim tx lewat RpcPool.sendOnce (sengaja TANPA failover)
 *   4. Tunggu status dari OpenSea
 *
 * Yang penting soal auto-retry: langkah 1-2 aman diulang, langkah 3 TIDAK.
 * Begitu tx terkirim, percobaan berhenti — mengulang pengiriman bisa
 * menghasilkan dua transaksi (double mint, gas dobel).
 */

import { preflight } from "./simulate.js";
import { withRetry, classifyError, traitsOf, ErrorKind } from "./retry.js";
import { fetchCalldataWithRetry } from "./graphql.js";
import { waitForMintStatus } from "./mint.js";

/** Catat satu percobaan ke aco_attempts untuk audit. */
async function recordAttempt(supabase, row) {
  try {
    await supabase.from("aco_attempts").insert(row);
  } catch (err) {
    console.error(`  [attempt] gagal catat: ${err?.message ?? err}`);
  }
}

export async function mintWalletGuarded({
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
}) {
  const { address, cookieStr, signerFor } = session;

  // Transaksi yang sudah terkirim di percobaan sebelumnya. Kalau ini terisi,
  // TIDAK boleh ada pengiriman lagi.
  let sentTxHash = null;

  const attemptLog = async (evt) => {
    if (evt.type === "error") {
      await log.warn(
        `Percobaan ${evt.attempt} gagal (${evt.kind}): ${String(evt.message).slice(0, 120)}`,
        address
      );
    } else if (evt.type === "waiting") {
      await log.info(`Menunggu ${evt.waitMs}ms sebelum percobaan ${evt.attempt + 1}`, address);
    } else if (evt.type === "recovered") {
      await log.ok(`Berhasil di percobaan ${evt.attempt}`, address);
    } else if (evt.type === "deadline") {
      await log.warn("Batas waktu percobaan tercapai", address);
    }
  };

  try {
    const result = await withRetry(
      async ({ attempt }) => {
        const t0 = Date.now();

        // Pengaman ganda: kalau tx sudah pernah terkirim, jangan pernah kirim
        // lagi walau ada retry dari lapisan mana pun.
        if (sentTxHash) {
          throw Object.assign(new Error(`Tx sudah terkirim (${sentTxHash})`), {
            alreadySent: true,
          });
        }

        // ---- 1. Calldata ---------------------------------------------------
        const calldataResults = await fetchCalldataWithRetry(
          [{ address, cookieStr }],
          contractAddress,
          chain,
          cookieStr,
          {
            startTime: startTs,
            // Attempt pertama dapat hammer penuh (menunggu stage buka).
            // Percobaan ulang lebih pendek — stage sudah buka, kalau masih
            // gagal berarti masalahnya lain.
            maxRetries: attempt === 1 ? 300 : 40,
            retryDelayMs: 200,
            quantity: String(job.mint_amount),
          }
        );

        if (!calldataResults || calldataResults.length === 0) {
          throw new Error("Tidak dapat calldata — wallet mungkin tidak eligible");
        }

        const calldata = calldataResults[0];

        // ---- 2. PREFLIGHT (anti-revert) ------------------------------------
        const pf = await preflight(
          pool,
          address,
          { to: calldata.to, data: calldata.data, value: calldata.value || "0" },
          { gasLimit: job.gas_limit, startTimeMs }
        );

        if (!pf.ok) {
          await log.error(`Preflight menolak: ${pf.reason}`, address);
          await recordAttempt(supabase, {
            job_id: job.id,
            wallet_address: address,
            attempt,
            outcome: "PREFLIGHT_FAIL",
            error_kind: pf.kind,
            error_message: pf.reason?.slice(0, 400),
            duration_ms: Date.now() - t0,
          });

          // abort_on_revert (default true): jangan kirim tx yang diperkirakan
          // gagal. Kalau user sengaja mematikannya, tx tetap dikirim.
          if (job.abort_on_revert !== false) {
            throw Object.assign(new Error(pf.reason), {
              preflightRejected: true,
              errorKind: pf.kind,
            });
          }
          await log.warn("abort_on_revert dimatikan — tx tetap dikirim", address);
        } else if (pf.degraded) {
          await log.warn(pf.reason || "Preflight tidak lengkap, tx tetap dikirim", address);
        } else {
          await log.ok(
            `Preflight lolos (gas ${pf.estimatedGas ?? "?"} → ${pf.gasLimit})`,
            address
          );
        }

        const gasLimit = pf.gasLimit || job.gas_limit;

        // ---- 3. Kirim tx (TANPA failover) ----------------------------------
        // Nonce diambil sedekat mungkin dengan pengiriman supaya tidak basi
        // kalau ada retry.
        const nonceRes = await pool.call(
          (p) => p.getTransactionCount(address, "pending"),
          { label: "getNonce" }
        );
        const feeRes = await pool.call((p) => p.getFeeData(), { label: "getFeeData" });

        const txRequest = {
          to: calldata.to,
          data: calldata.data,
          value: BigInt(calldata.value || "0"),
          nonce: nonceRes.result,
          gasLimit,
          maxFeePerGas: feeRes.result.maxFeePerGas,
          maxPriorityFeePerGas: feeRes.result.maxPriorityFeePerGas,
          chainId: job.chain_id,
        };

        const { tx, entry } = await pool.sendOnce(signerFor, txRequest, {
          label: "sendMintTx",
        });

        sentTxHash = tx.hash;
        await log.ok(`Tx dikirim: ${tx.hash} via ${entry.host}`, address);

        await recordAttempt(supabase, {
          job_id: job.id,
          wallet_address: address,
          attempt,
          outcome: "SENT",
          tx_hash: tx.hash,
          rpc_host: entry.host,
          gas_used: Number(gasLimit) || null,
          duration_ms: Date.now() - t0,
        });

        // ---- 4. Tunggu status ---------------------------------------------
        const receipt = await waitForMintStatus(
          tx.hash,
          contractAddress,
          chain,
          job.price_unit || "0",
          cookieStr
        );

        const success = receipt?.status === "SUCCESS";

        await recordAttempt(supabase, {
          job_id: job.id,
          wallet_address: address,
          attempt,
          outcome: success ? "SUCCESS" : "REVERTED",
          tx_hash: tx.hash,
          rpc_host: entry.host,
          duration_ms: Date.now() - t0,
        });

        if (success) {
          await log.ok(`Mint SUKSES · tx ${tx.hash}`, address);
        } else {
          await log.error(`Mint gagal menurut OpenSea (${receipt?.status})`, address);
        }

        return { address, success, txHash: tx.hash, rpcHost: entry.host };
      },
      {
        maxAttempts: Math.max(1, Math.min(job.max_attempts || 3, 10)),
        onEvent: attemptLog,
        // Jangan mencoba lebih dari 3 menit — mint window biasanya pendek dan
        // kalau sudah selama itu, peluangnya sudah habis.
        deadlineMs: 180000,
        label: address.slice(0, 8),
      }
    );

    return result;
  } catch (err) {
    const kind = err.errorKind || classifyError(err);

    // Tx sudah terkirim tapi statusnya tidak terkonfirmasi. JANGAN dilaporkan
    // sebagai gagal total — user perlu tahu hash-nya untuk diperiksa manual.
    if (sentTxHash) {
      await log.warn(
        `Tx terkirim (${sentTxHash}) tapi status tidak terkonfirmasi: ${err.message}`,
        address
      );
      await recordAttempt(supabase, {
        job_id: job.id,
        wallet_address: address,
        attempt: 0,
        outcome: "SENT",
        tx_hash: sentTxHash,
        error_kind: ErrorKind.TX_SENT_UNKNOWN,
        error_message: String(err.message).slice(0, 400),
      });
      return {
        address,
        success: false,
        txHash: sentTxHash,
        unconfirmed: true,
        error: `Tx terkirim tapi status tidak jelas: ${String(err.message).slice(0, 150)}`,
      };
    }

    const traits = traitsOf(kind);
    const label = err.preflightRejected ? "Dicegah sebelum kirim" : "Gagal";

    await log.error(`${label}: ${String(err.message).slice(0, 200)}`, address);

    await recordAttempt(supabase, {
      job_id: job.id,
      wallet_address: address,
      attempt: 0,
      outcome: err.preflightRejected ? "PREFLIGHT_FAIL" : "ERROR",
      error_kind: kind,
      error_message: String(err.message).slice(0, 400),
    });

    return {
      address,
      success: false,
      error: String(err.message).slice(0, 300),
      errorKind: kind,
      // Ditandai supaya UI bisa membedakan "gas diselamatkan" dari "benar-benar gagal"
      prevented: Boolean(err.preflightRejected),
      fatal: Boolean(traits.fatal),
    };
  }
}
