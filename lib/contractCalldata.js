/**
 * Susun calldata mint dan UJI DULU lewat simulasi sebelum kirim.
 *
 * Inti strateginya: jangan menebak. Untuk tiap kandidat fungsi + tiap variasi
 * argumen, jalankan `eth_call` dari alamat wallet asli. Yang tidak revert itu
 * yang dipakai. Kalau semua revert, tidak ada tx dikirim sama sekali — gas
 * tidak terbuang.
 *
 * Ini juga cara menangani WHITELIST vs FCFS tanpa hardcode: fungsi WL butuh
 * proof, jadi kalau proof tidak ada atau salah, simulasinya revert dan kandidat
 * berikutnya (fungsi publik) yang dipakai.
 */

import { Interface, getAddress } from "ethers";

/** Variasi argumen yang dicoba, diurutkan dari yang paling mungkin. */
function argVariants(fn, ctx) {
  const { quantity, recipient, proof, tokenIds } = ctx;
  const t = fn.types;
  const out = [];

  const isQty = (x) => /^uint(8|16|32|64|128|256)?$/.test(x);
  const isQtyArr = (x) => /^uint\d*\[\]$/.test(x);

  // Tanpa argumen: mint()
  if (t.length === 0) return [[]];

  // 1 argumen
  if (t.length === 1) {
    if (isQty(t[0])) out.push([quantity]);
    if (t[0] === "address") out.push([recipient]);
    if (isQtyArr(t[0]) && tokenIds?.length) out.push([tokenIds]);
    if (t[0] === "bytes32[]" && proof) out.push([proof]);
    if (t[0] === "bytes" && proof) out.push([proof]);
    return out;
  }

  // 2 argumen — urutan bisa apa saja, jadi dicoba dua-duanya.
  if (t.length === 2) {
    if (t[0] === "address" && isQty(t[1])) out.push([recipient, quantity]);
    if (isQty(t[0]) && t[1] === "address") out.push([quantity, recipient]);
    if (isQty(t[0]) && (t[1] === "bytes32[]" || t[1] === "bytes")) {
      out.push([quantity, proof ?? []]);
    }
    if ((t[0] === "bytes32[]" || t[0] === "bytes") && isQty(t[1])) {
      out.push([proof ?? [], quantity]);
    }
    if (isQtyArr(t[0]) && tokenIds?.length) out.push([tokenIds, quantity]);
    return out;
  }

  // 3+ argumen: isi per posisi berdasarkan tipe. Sisanya nilai netral.
  const guess = t.map((type) => {
    if (isQty(type)) return quantity;
    if (type === "address") return recipient;
    if (type === "bytes32[]") return proof ?? [];
    if (type === "bytes") return proof ?? "0x";
    if (isQtyArr(type)) return tokenIds ?? [];
    if (type === "bool") return true;
    if (type === "bytes32") return "0x" + "0".repeat(64);
    if (type === "string") return "";
    return 0;
  });
  out.push(guess);
  return out;
}

/**
 * Cari kombinasi fungsi + argumen + value yang LOLOS simulasi.
 *
 * @param provider ethers provider
 * @param opts.candidates hasil findMintFunctions(), sudah terurut
 * @param opts.priceWei harga per token (string/bigint). null = coba 0 dan quote.
 * @returns {Promise<{fn, args, value, calldata}>}
 * @throws kalau tidak ada satu pun yang lolos — pesan berisi revert terakhir.
 */
export async function resolveMintCall(provider, abi, address, opts) {
  const {
    candidates,
    quantity = 1,
    recipient,
    proof = null,
    tokenIds = null,
    priceWei = null,
    maxAttempts = 24,
  } = opts;

  const iface = new Interface(abi);
  const qty = BigInt(quantity);

  // Normalisasi dulu: alamat tanpa checksum benar akan ditolak ethers di dalam
  // loop, dan errornya tersembunyi di antara daftar revert. Lebih baik gagal
  // di sini dengan pesan yang jelas.
  let from;
  try {
    // Di-lowercase dulu: alamat dari DB/input user sering punya campuran huruf
    // yang checksum EIP-55-nya tidak valid, padahal alamatnya benar. getAddress
    // atas huruf kecil hanya memvalidasi BENTUK, lalu mengembalikan checksum
    // yang benar.
    from = getAddress(String(recipient).toLowerCase());
  } catch {
    throw new Error(`Alamat wallet tidak valid: ${recipient}`);
  }

  // value yang dicoba: gratis dulu (paling umum), lalu harga × jumlah.
  const values = [0n];
  if (priceWei != null && BigInt(priceWei) > 0n) {
    values.push(BigInt(priceWei) * qty);
  }

  const errors = [];
  let tried = 0;

  for (const fn of candidates) {
    if (fn.ownerOnly) continue;

    for (const args of argVariants(fn, { quantity: qty, recipient: from, proof, tokenIds })) {
      let calldata;
      try {
        calldata = iface.encodeFunctionData(fn.name, args);
      } catch (e) {
        errors.push(`${fn.signature}: encode gagal — ${e.shortMessage || e.message}`);
        continue;
      }

      for (const value of values) {
        if (++tried > maxAttempts) break;
        // Fungsi non-payable tidak bisa menerima value.
        if (value > 0n && !fn.payable) continue;

        try {
          await provider.call({ to: address, from, data: calldata, value });
          return { fn, args, value, calldata, simulated: true };
        } catch (e) {
          errors.push(
            `${fn.signature} value=${value}: ${(e.shortMessage || e.message || "").slice(0, 90)}`
          );
        }
      }
    }
  }

  const err = new Error(
    "Tidak ada kombinasi mint yang lolos simulasi. Kemungkinan mint belum " +
      "dibuka, wallet tidak eligible, atau butuh proof whitelist.\n" +
      errors.slice(0, 6).map((e) => "  · " + e).join("\n")
  );
  err.attempts = errors;
  throw err;
}

/**
 * Bentuk calldata langsung dari pilihan MANUAL user (fungsi + argumen).
 * Dipakai kalau user mengisi sendiri di UI, melewati deteksi otomatis.
 */
export function encodeManualCall(abi, fnSignature, args) {
  const iface = new Interface(abi);
  const name = fnSignature.includes("(") ? fnSignature.slice(0, fnSignature.indexOf("(")) : fnSignature;
  return iface.encodeFunctionData(name, args);
}
