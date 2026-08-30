import { ethers } from "ethers";

/**
 * Konfirmasi hasil mint dari BLOCKCHAIN, bukan dari OpenSea.
 *
 * Kenapa ini ada — pelajaran dari log user:
 *
 *   OK    Tx dikirim: 0x4e43…1d5e
 *   WARN  Percobaan 1 gagal (RATE_LIMIT): 429 (gql.opensea.io)
 *   WARN  Percobaan 2 gagal: Tx sudah terkirim
 *   WARN  Percobaan 3 gagal: Tx sudah terkirim
 *   OK    Selesai — 0/1 wallet berhasil mint
 *
 * NFT-nya sebenarnya BERHASIL ter-mint. Yang gagal cuma pembacaan status dari
 * `gql.opensea.io` karena kena rate limit. Melaporkan "0/1 berhasil" padahal
 * mint sukses itu salah — dan yang lebih buruk, retry-nya sia-sia.
 *
 * Chain adalah sumber kebenaran: receipt transaksi tidak bisa kena rate limit
 * OpenSea, tidak butuh cookie, dan hasilnya pasti. OpenSea hanya dipakai untuk
 * MELENGKAPI (nama koleksi, gambar) setelah statusnya sudah pasti dari chain.
 */

// Transfer(address,address,uint256) — ERC-721
const ERC721_TRANSFER = ethers.id("Transfer(address,address,uint256)");
// TransferSingle(address,address,address,uint256,uint256) — ERC-1155
const ERC1155_SINGLE = ethers.id("TransferSingle(address,address,address,uint256,uint256)");
// TransferBatch(address,address,address,uint256[],uint256[]) — ERC-1155
const ERC1155_BATCH = ethers.id("TransferBatch(address,address,address,uint256[],uint256[])");

const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * Ambil token yang ter-mint ke `recipient` dari log receipt.
 *
 * Yang dicari: transfer DARI address nol (itu definisi mint) KE wallet kita.
 * Transfer biasa diabaikan supaya tidak salah menghitung.
 *
 * TENTANG FILTER KONTRAK — temuan dari transaksi sungguhan user:
 *
 *   OpenSea memberi contract address `0x5cae…328e`, tapi NFT-nya ternyata
 *   di-mint dari `0x4997…5390`. Kalau log difilter ketat ke alamat yang
 *   diberikan OpenSea, hasilnya 0 token — padahal 2 token benar-benar masuk.
 *
 *   Ini normal di arsitektur seperti SeaDrop: alamat yang dipanggil (`to`) dan
 *   alamat kontrak NFT bisa berbeda, dan slug OpenSea bisa menunjuk ke salah
 *   satunya. Jadi filter dipakai sebagai PREFERENSI, bukan syarat: kalau
 *   pencocokan ketat tidak memberi hasil, semua mint ke wallet ini diterima.
 */
export function extractMintedTokens(receipt, recipient, contractAddress) {
  const want = String(recipient || "").toLowerCase();
  const wantContract = contractAddress ? String(contractAddress).toLowerCase() : null;

  // Kumpulkan SEMUA mint ke wallet ini dulu, tanpa memandang kontraknya.
  const all = [];

  for (const logEntry of receipt?.logs ?? []) {
    const topic0 = logEntry.topics?.[0];

    try {
      if (topic0 === ERC721_TRANSFER && logEntry.topics.length >= 4) {
        const from = ethers.getAddress("0x" + logEntry.topics[1].slice(26));
        const to = ethers.getAddress("0x" + logEntry.topics[2].slice(26));
        if (from.toLowerCase() !== ZERO) continue; // bukan mint
        if (to.toLowerCase() !== want) continue;

        all.push({
          tokenId: BigInt(logEntry.topics[3]).toString(),
          standard: "ERC721",
          quantity: 1,
          contract: ethers.getAddress(logEntry.address),
        });
        continue;
      }

      if (topic0 === ERC1155_SINGLE && logEntry.topics.length >= 4) {
        const from = ethers.getAddress("0x" + logEntry.topics[2].slice(26));
        const to = ethers.getAddress("0x" + logEntry.topics[3].slice(26));
        if (from.toLowerCase() !== ZERO) continue;
        if (to.toLowerCase() !== want) continue;

        const [id, value] = ethers.AbiCoder.defaultAbiCoder().decode(
          ["uint256", "uint256"],
          logEntry.data
        );
        all.push({
          tokenId: id.toString(),
          standard: "ERC1155",
          quantity: Number(value),
          contract: ethers.getAddress(logEntry.address),
        });
        continue;
      }

      if (topic0 === ERC1155_BATCH && logEntry.topics.length >= 4) {
        const from = ethers.getAddress("0x" + logEntry.topics[2].slice(26));
        const to = ethers.getAddress("0x" + logEntry.topics[3].slice(26));
        if (from.toLowerCase() !== ZERO) continue;
        if (to.toLowerCase() !== want) continue;

        const [ids, values] = ethers.AbiCoder.defaultAbiCoder().decode(
          ["uint256[]", "uint256[]"],
          logEntry.data
        );
        for (let i = 0; i < ids.length; i++) {
          all.push({
            tokenId: ids[i].toString(),
            standard: "ERC1155",
            quantity: Number(values[i]),
            contract: ethers.getAddress(logEntry.address),
          });
        }
      }
    } catch {
      // Log yang tidak bisa didecode dilewati — jangan sampai satu log aneh
      // menggagalkan seluruh pembacaan.
    }
  }

  if (!wantContract) return all;

  // Utamakan yang kontraknya cocok; kalau tidak ada yang cocok, pakai semuanya.
  const matched = all.filter((t) => t.contract.toLowerCase() === wantContract);
  return matched.length > 0 ? matched : all;
}

/**
 * Tunggu receipt dari chain, lalu simpulkan hasilnya.
 *
 * @returns {{ confirmed, success, receipt, tokens, gasUsed, blockNumber, reason }}
 */
export async function confirmOnChain(pool, txHash, recipient, contractAddress, { log = null, timeoutMs = 120000 } = {}) {
  const t0 = Date.now();

  try {
    // waitForTransaction lewat pool: kalau RPC yang dipakai mati, pindah.
    const { result: receipt } = await pool.call(
      (p) => p.waitForTransaction(txHash, 1, timeoutMs),
      { label: "waitForTx" }
    );

    if (!receipt) {
      return {
        confirmed: false,
        success: false,
        tokens: [],
        reason: `Receipt belum muncul setelah ${Math.round(timeoutMs / 1000)}s`,
      };
    }

    // status 0 = revert. Ini kepastian, bukan dugaan.
    if (receipt.status === 0) {
      return {
        confirmed: true,
        success: false,
        receipt,
        tokens: [],
        gasUsed: receipt.gasUsed?.toString() ?? null,
        blockNumber: receipt.blockNumber,
        reason: "Transaksi REVERT di chain",
      };
    }

    const tokens = extractMintedTokens(receipt, recipient, contractAddress);

    await log?.info?.(
      `Terkonfirmasi di block ${receipt.blockNumber} · ${tokens.length} token · ${Date.now() - t0}ms`,
      recipient
    );

    return {
      confirmed: true,
      success: true,
      receipt,
      tokens,
      gasUsed: receipt.gasUsed?.toString() ?? null,
      effectiveGasPrice: receipt.gasPrice?.toString() ?? null,
      blockNumber: receipt.blockNumber,
      // Tx sukses tapi tidak ada token masuk = ganjil, perlu diberi tahu.
      reason:
        tokens.length === 0
          ? "Tx sukses tapi tidak ada token yang masuk ke wallet ini"
          : null,
    };
  } catch (err) {
    return {
      confirmed: false,
      success: false,
      tokens: [],
      reason: `Gagal baca receipt: ${String(err.message).slice(0, 160)}`,
    };
  }
}
