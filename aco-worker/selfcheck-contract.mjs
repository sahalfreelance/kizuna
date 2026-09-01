// Self-check gabungan: satu berkas yang membuktikan bagian berisiko masih benar.
// Jalankan dari aco-worker: node selfcheck-contract.mjs
import assert from "node:assert/strict";
import { fetchAbi } from "../lib/abiFetch.js";
import { findMintFunctions, readContractState, detectMintMode, priceFromState }
  from "../lib/contractMint.js";
import { resolveMintCall } from "../lib/contractCalldata.js";
import { JsonRpcProvider } from "ethers";

const CA = "0x929B333DD6334eb1fbA041b8738184b24301EA20";
const RPC = "https://robinhood-rpc.publicnode.com";
let n = 0;
const ok = (m) => { n++; console.log(`  ok ${n} — ${m}`); };

// 1. ABI kontrak TIDAK verified tetap dapat, lewat bytecode.
const info = await fetchAbi(CA, "robinhood", { rpcUrl: RPC });
assert.equal(info.verified, false);
assert.equal(info.source, "bytecode");
assert.ok(info.abi.length > 0);
ok(`ABI kontrak tidak verified direkonstruksi (${info.abi.length} entri)`);

// 2. Fungsi mint publik terdeteksi, owner-only tidak ikut jadi kandidat utama.
const fns = findMintFunctions(info.abi);
const pub = fns.filter((f) => !f.ownerOnly);
assert.ok(pub.length >= 1);
assert.equal(pub[0].name, "mint");
ok(`fungsi mint publik terdeteksi: ${pub.map((f) => f.signature).join(", ")}`);

// 3. State on-chain terbaca.
const state = await readContractState(CA, info.abi, RPC);
assert.ok(state.totalSupply != null, "totalSupply harus terbaca");
ok(`state terbaca: supply ${state.totalSupply}/${state.MAX_SUPPLY ?? "?"}`);

// 4. Mode terdeteksi, dan flag mint tertutup ikut terbaca.
const mode = detectMintMode(info.abi, state, fns);
assert.ok(["FCFS", "WHITELIST", "UNKNOWN"].includes(mode.mode));
assert.equal(typeof mode.gated, "boolean");
// gated mengikuti keadaan kontrak saat ini — kontrak ini sudah buka mintnya,
// jadi nilainya tidak dipaku. Yang dipastikan: nilainya konsisten dengan flag
// mintActive yang dibaca dari kontrak.
if (state.mintActive === true) assert.equal(mode.gated, false);
if (state.mintActive === false) assert.equal(mode.gated, true);
ok(`mode ${mode.mode}, gated=${mode.gated} (mintActive=${state.mintActive})`);

// 5. Harga terbaca sebagai string wei (bukan BigInt) supaya aman di JSON.
const price = priceFromState(state);
assert.ok(price === null || typeof price === "string");
ok(`harga: ${price ?? "tidak terbaca"}`);

// 6. INTI PENGAMAN: mint tertutup -> resolveMintCall WAJIB gagal, tidak boleh
//    mengembalikan calldata. Ini yang mencegah gas terbakar.
const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });

// 6a. Wallet TANPA dana: mint berbayar 360000000000000 wei, jadi semua
//     kombinasi harus ditolak dan TIDAK ADA calldata dikembalikan.
await assert.rejects(
  () => resolveMintCall(provider, info.abi, CA, {
    candidates: fns,
    recipient: "0x1111111111111111111111111111111111111111",
    quantity: 1,
    priceWei: price,
    maxAttempts: 1,
  }),
  /lolos|revert|simulasi/i
);
ok("wallet tanpa dana: tidak ada calldata dikembalikan (gas aman)");

// 6b. Wallet BERDANA bukan owner: harus lolos, dan value HARUS sama dengan
//     harga yang dibaca dari kontrak — bukan 0.
const BERDANA = "0xfdfe0b961b7b178204b522b7d0316208f1934387";
const r = await resolveMintCall(provider, info.abi, CA, {
  candidates: fns,
  recipient: BERDANA,
  quantity: 1,
  priceWei: price,
  maxAttempts: 40,
});
assert.equal(r.fn.signature, "mint(uint256)");
assert.equal(String(r.args[0]), "1");
assert.equal(String(r.value), String(price));
assert.ok(r.calldata.startsWith("0xa0712d68"), "selector mint(uint256)");
ok(`wallet berdana: ${r.fn.signature} args=[1] value=${r.value} calldata=${r.calldata.slice(0, 10)}…`);

provider.destroy();
// 7. rpcUrl kosong ditolak seketika, bukan menggantung retry tanpa henti.
const t = Date.now();
await assert.rejects(() => readContractState(CA, [], undefined), /rpcUrl wajib/);
assert.ok(Date.now() - t < 500, "harus gagal cepat");
ok(`guard rpcUrl kosong: ditolak dalam ${Date.now() - t}ms`);

console.log(`\n${n}/${n} lolos`);
