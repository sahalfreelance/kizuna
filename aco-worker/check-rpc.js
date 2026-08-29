import "dotenv/config";
import { ethers } from "ethers";
import { SUPPORTED_CHAINS } from "./lib/chains.js";

/**
 * Uji RPC semua chain tanpa perlu Supabase/API key.
 *
 *     node check-rpc.js
 *     node check-rpc.js https://eth-mainnet.g.alchemy.com/v2/KEY 1
 *
 * Bentuk kedua menguji satu RPC tertentu terhadap chain id yang diharapkan —
 * berguna untuk memeriksa RPC user sebelum disimpan.
 */

const [argUrl, argChainId] = process.argv.slice(2);

async function probe(url, expectedChainId, label) {
  try {
    const provider = url.startsWith("ws")
      ? new ethers.WebSocketProvider(url)
      : new ethers.JsonRpcProvider(url);

    const t0 = Date.now();
    const net = await provider.getNetwork();
    const ms = Date.now() - t0;
    const block = await provider.getBlockNumber();

    await provider.destroy?.();

    const match = expectedChainId == null || Number(net.chainId) === Number(expectedChainId);

    console.log(
      `  ${match ? "✓" : "✗"} ${String(label).padEnd(14)} ` +
        `chainId ${String(net.chainId).padEnd(9)} block ${String(block).padEnd(11)} ${ms}ms` +
        (match ? "" : `  TIDAK COCOK — seharusnya ${expectedChainId}`)
    );
    return match;
  } catch (err) {
    console.log(`  ✗ ${String(label).padEnd(14)} ${String(err.message).slice(0, 60)}`);
    return false;
  }
}

if (argUrl) {
  console.log("");
  await probe(argUrl, argChainId ? Number(argChainId) : null, "RPC");
  console.log("");
  process.exit(0);
}

console.log("");
console.log("  Uji RPC default semua chain:");
console.log("");

let ok = 0;
for (const c of SUPPORTED_CHAINS) {
  const url = c.defaultRpc || process.env.RPC_URL;
  if (!url) {
    console.log(`  ✗ ${c.label.padEnd(14)} tidak ada RPC`);
    continue;
  }
  if (await probe(url, c.chainId, c.label)) ok++;
}

console.log("");
console.log(`  ${ok}/${SUPPORTED_CHAINS.length} chain OK`);
console.log("");
console.log("  RPC publik gratis rate-limit-nya ketat dan bisa lambat.");
console.log("  Untuk mint kompetitif, simpan RPC sendiri di halaman /aco.");
console.log("");
process.exit(0);
