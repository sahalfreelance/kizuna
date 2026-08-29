import { ethers } from "ethers";
import { classifyError, ErrorKind } from "./retry.js";

/**
 * Anti-revert: periksa transaksi SEBELUM dikirim.
 *
 * Kenapa penting: tx yang revert tetap membakar gas. Saat mint rame, gas bisa
 * mahal — mengirim 10 tx yang semuanya revert artinya membuang uang tanpa
 * mendapat apa pun. Padahal penyebabnya biasanya bisa dideteksi lebih dulu:
 * stage belum buka, wallet tidak eligible, sudah kena batas per wallet, atau
 * saldo tidak cukup.
 *
 * Empat pemeriksaan, dari yang paling murah:
 *   1. Stage sudah buka? (cek waktu, tanpa jaringan)
 *   2. Saldo cukup untuk value + gas?
 *   3. eth_call — simulasi eksekusi. Kalau revert, alasannya di-decode.
 *   4. estimateGas — untuk menetapkan gas limit yang wajar.
 *
 * Hasil `ok: false` BUKAN kegagalan sistem. Itu artinya sistem berhasil
 * mencegah gas terbuang.
 */

/** Decode revert reason dari data error. Banyak kontrak pakai custom error. */
function decodeRevert(err) {
  // ethers v6 menaruh data revert di beberapa tempat berbeda.
  const data =
    err?.data ??
    err?.info?.error?.data ??
    err?.error?.data ??
    err?.transaction?.data;

  // Alasan berbentuk string biasa (Error(string)).
  if (err?.reason) return err.reason;

  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    // Error(string) punya selector 0x08c379a0
    if (data.startsWith("0x08c379a0")) {
      try {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ["string"],
          "0x" + data.slice(10)
        );
        return decoded[0];
      } catch {
        /* jatuh ke bawah */
      }
    }
    // Panic(uint256), selector 0x4e487b71
    if (data.startsWith("0x4e487b71")) {
      return "panic (assert/overflow di kontrak)";
    }
    // Custom error — tidak bisa di-decode tanpa ABI, tapi selectornya berguna
    // untuk dicari tahu.
    return `custom error ${data.slice(0, 10)}`;
  }

  const msg = String(err?.shortMessage || err?.message || "");
  const m = msg.match(/reverted(?: with reason string)?[:\s]+"?([^"]+)"?/i);
  if (m) return m[1];

  return msg.slice(0, 200) || "tidak diketahui";
}

/**
 * @param pool        RpcPool
 * @param address     alamat wallet pengirim
 * @param txRequest   { to, data, value }
 * @param opts        { gasLimit, startTimeMs, skipBalanceCheck }
 */
export async function preflight(pool, address, txRequest, opts = {}) {
  const {
    gasLimit = 300000,
    startTimeMs = null,
    graceMs = 3000,
  } = opts;

  const checks = [];
  const t0 = Date.now();

  // ---- 1. Stage sudah buka? -----------------------------------------------
  // Ini pemeriksaan paling murah dan penyebab revert paling umum. Toleransi
  // `graceMs` supaya selisih jam server tidak menolak mint yang sebenarnya
  // sudah buka.
  if (startTimeMs != null) {
    const early = startTimeMs - Date.now();
    if (early > graceMs) {
      checks.push({ name: "stage_open", ok: false, detail: `stage baru buka ${Math.round(early / 1000)}s lagi` });
      return {
        ok: false,
        kind: ErrorKind.NOT_LIVE,
        reason: `Stage belum buka (${Math.round(early / 1000)} detik lagi)`,
        checks,
        durationMs: Date.now() - t0,
      };
    }
    checks.push({ name: "stage_open", ok: true });
  }

  const value = BigInt(txRequest.value || "0");

  // ---- 2. Saldo cukup? ----------------------------------------------------
  let balance = null;
  let feeData = null;
  try {
    const [balRes, feeRes] = await Promise.all([
      pool.call((p) => p.getBalance(address), { label: "getBalance" }),
      pool.call((p) => p.getFeeData(), { label: "getFeeData" }),
    ]);
    balance = balRes.result;
    feeData = feeRes.result;

    const maxFee = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    const gasCost = maxFee * BigInt(gasLimit);
    const needed = value + gasCost;

    if (balance < needed) {
      checks.push({
        name: "balance",
        ok: false,
        detail: `punya ${ethers.formatEther(balance)}, butuh ~${ethers.formatEther(needed)}`,
      });
      return {
        ok: false,
        kind: ErrorKind.INSUFFICIENT_FUNDS,
        reason:
          `Saldo tidak cukup: ada ${ethers.formatEther(balance)}, ` +
          `perlu ~${ethers.formatEther(needed)} (harga + gas)`,
        checks,
        durationMs: Date.now() - t0,
      };
    }
    checks.push({
      name: "balance",
      ok: true,
      detail: `${ethers.formatEther(balance)} tersedia`,
    });
  } catch (err) {
    // Gagal membaca saldo itu masalah RPC, bukan alasan membatalkan mint.
    checks.push({ name: "balance", ok: null, detail: `tidak bisa dicek: ${err.message?.slice(0, 80)}` });
  }

  // ---- 3. eth_call: simulasi eksekusi ------------------------------------
  try {
    await pool.call(
      (p) =>
        p.call({
          from: address,
          to: txRequest.to,
          data: txRequest.data,
          value,
        }),
      { label: "eth_call" }
    );
    checks.push({ name: "simulate", ok: true });
  } catch (err) {
    const kind = classifyError(err);

    // Kalau kegagalannya karena RPC, jangan simpulkan tx akan revert —
    // itu kesimpulan yang salah dan bisa membatalkan mint yang sehat.
    if (kind === ErrorKind.RPC_DOWN || kind === ErrorKind.RATE_LIMIT) {
      checks.push({ name: "simulate", ok: null, detail: `tidak bisa disimulasi (${kind})` });
      return {
        ok: true,
        degraded: true,
        reason: "Simulasi dilewati karena RPC bermasalah — tx tetap dikirim",
        checks,
        gasLimit,
        durationMs: Date.now() - t0,
      };
    }

    const reason = decodeRevert(err);
    checks.push({ name: "simulate", ok: false, detail: reason });
    return {
      ok: false,
      kind: ErrorKind.WOULD_REVERT,
      reason: `Simulasi memperkirakan REVERT: ${reason}`,
      checks,
      durationMs: Date.now() - t0,
    };
  }

  // ---- 4. estimateGas ----------------------------------------------------
  let estimatedGas = null;
  try {
    const est = await pool.call(
      (p) =>
        p.estimateGas({
          from: address,
          to: txRequest.to,
          data: txRequest.data,
          value,
        }),
      { label: "estimateGas" }
    );
    estimatedGas = est.result;

    // Beri margin 25%: kondisi on-chain bisa sedikit berubah antara simulasi
    // dan eksekusi (misal jumlah minted bertambah).
    const withMargin = (estimatedGas * 125n) / 100n;
    const finalGas = withMargin > BigInt(gasLimit) ? withMargin : BigInt(gasLimit);

    checks.push({
      name: "gas",
      ok: true,
      detail: `estimasi ${estimatedGas}, dipakai ${finalGas}`,
    });

    return {
      ok: true,
      checks,
      estimatedGas: estimatedGas.toString(),
      gasLimit: Number(finalGas),
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    // estimateGas gagal padahal eth_call lolos: kondisinya di ambang. Pakai
    // gas limit dari user dan lanjut — jangan batalkan.
    checks.push({
      name: "gas",
      ok: null,
      detail: `estimasi gagal, pakai gasLimit user (${gasLimit})`,
    });
    return {
      ok: true,
      degraded: true,
      checks,
      gasLimit,
      durationMs: Date.now() - t0,
    };
  }
}
