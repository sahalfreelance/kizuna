/**
 * Eksekusi mint langsung ke kontrak (platform "contract").
 *
 * Beda mendasar dengan jalur OpenSea: tidak ada API yang memberi calldata, jadi
 * calldata disusun sendiri dari ABI. Karena itu tiap percobaan WAJIB lewat
 * `eth_call` dulu — kalau simulasi revert, tidak ada tx dikirim dan gas tidak
 * terbuang.
 *
 * Pola hammer-nya sama seperti OpenSea: saat window mint dibuka, simulasi
 * diulang cepat sampai lolos (mint belum aktif = revert), lalu tx dikirim
 * sekali. Yang di-hammer adalah SIMULASI, bukan pengiriman tx — jadi tidak ada
 * risiko dobel mint.
 */

import { JsonRpcProvider, Wallet, Interface } from "ethers";
import { fetchAbi } from "../../lib/abiFetch.js";
import {
  findMintFunctions,
  readContractState,
  detectMintMode,
  priceFromState,
} from "../../lib/contractMint.js";
import { resolveMintCall } from "../../lib/contractCalldata.js";

const SIM_INTERVAL_MS = 200;
const DEFAULT_MAX_SIM = 300;

/**
 * Siapkan semua yang tidak berubah selama menunggu window: ABI, kandidat
 * fungsi, harga. Dipanggil SEBELUM window buka supaya saat detik-J tidak ada
 * pekerjaan sia-sia.
 */
export async function prepareContractMint({ address, chain, rpcUrl, etherscanKey }) {
  const info = await fetchAbi(address, chain, { rpcUrl, etherscanKey });
  const candidates = findMintFunctions(info.abi);

  if (candidates.filter((f) => !f.ownerOnly).length === 0) {
    throw new Error(
      "Tidak ada fungsi mint publik yang terdeteksi di kontrak ini. " +
        "Pilih fungsi manual di UI."
    );
  }

  const state = await readContractState(address, info.abi, rpcUrl);
  const mode = detectMintMode(info.abi, state, candidates);

  return {
    abi: info.abi,
    abiSource: info.source,
    verified: info.verified,
    candidates,
    state,
    mode,
    priceWei: priceFromState(state),
  };
}

/**
 * Hammer simulasi sampai lolos, lalu kirim satu tx.
 *
 * @param opts.manual  { signature, args } kalau user memilih fungsi sendiri.
 * @param opts.onLog   callback log per percobaan (opsional)
 * @returns {{txHash, fn, args, value, attempts}}
 */
export async function executeContractMint({
  privateKey,
  address,
  rpcUrl,
  prepared,
  quantity = 1,
  proof = null,
  tokenIds = null,
  manual = null,
  gasLimit = null,
  maxSimAttempts = DEFAULT_MAX_SIM,
  onLog = () => {},
}) {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true });
  const wallet = new Wallet(privateKey, provider);

  let resolved = null;
  let attempts = 0;
  let lastError = null;

  while (attempts < maxSimAttempts) {
    attempts++;
    try {
      if (manual?.signature) {
        // Pilihan manual tetap disimulasikan — user bisa salah isi argumen.
        const iface = new Interface(prepared.abi);
        const name = manual.signature.slice(0, manual.signature.indexOf("("));
        const calldata = iface.encodeFunctionData(name, manual.args || []);
        const value = BigInt(manual.value ?? 0);
        await provider.call({ to: address, from: wallet.address, data: calldata, value });
        resolved = { fn: { signature: manual.signature }, args: manual.args || [], value, calldata };
      } else {
        resolved = await resolveMintCall(provider, prepared.abi, address, {
          candidates: prepared.candidates,
          quantity,
          recipient: wallet.address,
          proof,
          tokenIds,
          priceWei: prepared.priceWei,
        });
      }
      break;
    } catch (e) {
      lastError = e;
      if (attempts % 25 === 0) {
        onLog(`simulasi ${attempts}/${maxSimAttempts} masih revert — mint belum buka`);
      }
      await sleep(SIM_INTERVAL_MS);
    }
  }

  if (!resolved) {
    const err = new Error(
      `Simulasi tidak pernah lolos setelah ${attempts} percobaan. ` +
        (lastError?.message || "")
    );
    err.attempts = attempts;
    throw err;
  }

  onLog(`simulasi LOLOS di percobaan ${attempts}: ${resolved.fn.signature} value=${resolved.value}`);

  // Gas limit: estimasi + 25% buffer. Kalau estimasi gagal (jarang, karena
  // simulasi baru saja lolos), pakai nilai dari user atau default aman.
  let gas = gasLimit ? BigInt(gasLimit) : null;
  if (!gas) {
    try {
      const est = await provider.estimateGas({
        to: address,
        from: wallet.address,
        data: resolved.calldata,
        value: resolved.value,
      });
      gas = (est * 125n) / 100n;
    } catch {
      gas = 300000n;
    }
  }

  const tx = await wallet.sendTransaction({
    to: address,
    data: resolved.calldata,
    value: resolved.value,
    gasLimit: gas,
  });

  onLog(`tx terkirim: ${tx.hash}`);

  return {
    txHash: tx.hash,
    fn: resolved.fn.signature,
    args: (resolved.args || []).map(String),
    value: resolved.value.toString(),
    gasLimit: gas.toString(),
    attempts,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
