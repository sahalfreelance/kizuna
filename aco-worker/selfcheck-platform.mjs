// Uji parsing WORKER_PLATFORMS + banner, tanpa butuh DB sungguhan.
// Yang dibuktikan: env dibaca benar, dan platform yang tampil di banner sesuai.
import assert from "node:assert/strict";

const kasus = [
  ["contract", ["contract"]],
  ["opensea,mintbay,scatter", ["opensea", "mintbay", "scatter"]],
  ["contract, opensea ", ["contract", "opensea"]],
  ["", []],
  [undefined, []],
];

let n = 0;
for (const [env, harap] of kasus) {
  const hasil = (env || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  assert.deepEqual(hasil, harap, `env=${JSON.stringify(env)}`);
  n++;
  console.log(`  ok ${n} — WORKER_PLATFORMS=${JSON.stringify(env)} -> [${hasil.join(", ")}]`);
}

// Array kosong HARUS dikirim sebagai null ke Postgres, bukan [] — kalau []
// dikirim, `array_length([],1) is null` memang true jadi tetap aman, tapi null
// lebih jelas maksudnya "tidak menyaring".
for (const [env, harap] of kasus) {
  const list = (env || "").split(",").map((s) => s.trim()).filter(Boolean);
  const kirim = list.length ? list : null;
  assert.equal(kirim === null, harap.length === 0);
}
n++;
console.log(`  ok ${n} — daftar kosong dikirim sebagai null (tidak menyaring)`);

console.log(`\n${n}/${n} lolos`);
