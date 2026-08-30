# Kizuna — paket final

Login username+password, ACO multi-platform, eligibility checker, worker VPS.
Struktur folder sudah sama dengan repo — tinggal `cp -r`.

Menggantikan semua zip sebelumnya. 74 file, tanpa `.env`/`node_modules`.

---

## ⚠ Update ini: job jalan BERSAMAAN

**Jawaban pertanyaan lu: iya, dulu mengantre. Sekarang tidak.**

Ada 3 masalah yang gw temukan dan perbaiki:

1. **Job diproses satu per satu.** Karena job menunggu window mint (bisa
   berjam-jam), job lain tertahan di antrean sampai jadwalnya kelewat.
2. **Job yang sedang menunggu dibunuh sendiri** setelah 30 menit. Artinya
   menjadwalkan mint lebih dari 30 menit di depan **tidak pernah bisa berhasil**.
3. **Dua job dengan wallet sama bisa saling menimpa tx.**

Worker naik ke **v6**. **Ada migration baru.**

---

## Pasang

```bash
cd ~/kizuna
cp -r /path/ke/kizuna_final/. .
rm -f PASANG.md CHANGELOG.md

npm install
cd aco-worker && npm install && cd ..
```

**Migration WAJIB** di Supabase SQL Editor:

```
supabase/migration_aco_parallel.sql
```

Tanpa ini worker tetap jalan tapi **masih sequential**, dan pembersihan job mati
dilewati (sengaja — mekanisme lamanya justru membunuh job yang sedang menunggu).
`node worker.js --check` akan memberi tahu kalau belum dijalankan.

```bash
NEXT_PUBLIC_SUPABASE_URL="https://dummy.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="dummy" \
AUTH_SESSION_SECRET="dummy-panjang-sekali" \
WALLET_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
WORKER_SHARED_SECRET="dummy" \
npx next build

git add -A
git status --short | grep -E "\.env$|node_modules" && echo "STOP" || echo "aman"
git commit -m "feat(aco): job paralel + heartbeat + kunci nonce per wallet"
git push origin main

cd aco-worker && node worker.js --check && cd ..
pm2 restart kizuna-aco-worker
pm2 logs kizuna-aco-worker --lines 20
```

`--check` harus menampilkan `✓ Job paralel siap (maks 8 bersamaan)`, dan log
harus **`Kizuna ACO Worker v6`**.

---

## Masalah 1: antrean

Kode lamanya:

```js
const job = await claimNextJob();
if (job) await processJob(job);   // ← memblokir sampai selesai
```

Skenario yang bikin kacau:

```
Job A: mint 20:00  → diambil 14:00, TIDUR 6 jam di dalam processJob
Job B: mint 14:30  → nunggu di QUEUED… kelewat, gagal
Job C: user lain   → sama, kelewat
```

Sekarang `processJob` tidak di-`await` di loop — ia jalan di latar, jadi loop
langsung mengambil job berikutnya. Sampai **8 job bersamaan** (bisa diubah lewat
`MAX_CONCURRENT_JOBS`).

Aman dijalankan bersamaan karena beban tiap job hampir nol saat menunggu; yang
padat cuma detik-detik mint, dan itu sudah dijaga rate limiter per-host.

**Urutan pengambilan juga diperbaiki.** Dulu urut `created_at` — job yang dibuat
lebih dulu diambil lebih dulu, walau jadwalnya jauh. Sekarang urut
`stage_start_time`: job yang mau mint 10 menit lagi menang dari job yang mau mint
6 jam lagi.

Klaim job dipindah ke fungsi Postgres dengan `for update skip locked`, jadi
pengambilan paralel tidak bisa bertabrakan.

Diuji dengan simulasi 3 job:

```
SEQUENTIAL (lama)  A=632ms  B=762ms KELEWAT  C=943ms KELEWAT   → 2/3 kelewat
PARALEL (baru)     A=631ms  B=131ms          C=181ms           → 0/3 kelewat
```

---

## Masalah 2: job dibunuh saat menunggu

Ini yang lebih berbahaya, dan gw temukan sambil memeriksa pertanyaan lu:

```js
async function releaseStuckJobs() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  // CLAIMED/RUNNING lebih tua dari 30 menit → FAILED "job nyangkut"
```

Job yang **sah sedang menunggu** window 6 jam ke depan ikut dibunuh setelah 30
menit dan ditandai nyangkut. Jadi mint yang dijadwalkan lebih dari 30 menit di
depan sebenarnya tidak pernah bisa berhasil — terlepas dari masalah antrean.

Sekarang pakai **heartbeat**: job hidup menandai dirinya tiap 30 detik, dan hanya
job tanpa kabar 3 menit yang dianggap mati (worker crash / restart). Job yang
menunggu berjam-jam tidak tersentuh.

---

## Masalah 3: dua job, satu wallet

Kalau lu jadwalkan 2 slug dengan wallet yang sama dan windownya bertabrakan,
keduanya membaca nonce "pending" yang sama, lalu tx kedua **menimpa** tx pertama
di mempool — satu mint hilang tanpa jejak, gas tetap terbakar.

Bagian ambil-nonce → kirim-tx sekarang dikunci **per wallet**. Wallet berbeda
tidak saling menunggu, jadi mint paralel multi-wallet tetap secepat sebelumnya.

Diuji: wallet sama berurutan tanpa tumpang tindih, wallet beda paralel (120ms vs
240ms), error tidak menyebabkan deadlock, tidak ada kebocoran memori.

---

## Hasil tes

```
simulasi loop
  sequential 2/3 job kelewat · paralel 0/3 ✓
  paralel 1.5x lebih cepat ✓

kunci per wallet
  wallet sama = berurutan, tanpa overlap ✓
  wallet beda = paralel (120ms vs 240ms) ✓
  error tidak deadlock, lock lepas ✓
  return value diteruskan ✓
  50 operasi → 0 entri tersisa (tidak bocor) ✓

build              ✓ Compiled successfully
syntax semua JS    0 gagal
worker --check     v6, pesan jelas kalau migration belum jalan
```

Satu bug gw temukan sendiri saat menguji: kunci wallet awalnya bocor (52 entri
tersisa setelah 50 operasi) karena `.then()` membuat promise baru tiap dipanggil,
jadi perbandingan pembersihannya selalu gagal. Sudah diperbaiki — sekarang 0.

---

## Yang belum terverifikasi

Gw **tidak menyentuh database lu dan tidak mengirim transaksi apa pun.**

- **Paralel dengan DB sungguhan.** Yang teruji: logika loop (simulasi), kunci
  wallet (unit test), dan build. Fungsi Postgres `aco_claim_job` /
  `aco_release_dead_jobs` **belum pernah dijalankan** — sintaksnya gw tulis
  hati-hati tapi belum dieksekusi Postgres.
- **Heartbeat di kondisi nyata** (job menunggu berjam-jam lalu tetap hidup).
- Perilaku saat 8 slot penuh dan job ke-9 masuk.

Tes yang paling berguna: **jadwalkan 2 slug bersamaan**, lalu lihat `pm2 logs`.
Harus muncul dua baris `job … mulai · 2/8 slot terpakai` — bukan satu job
menunggu yang lain. Kalau `--check` mengeluh soal `heartbeat_at`, migration-nya
belum jalan.
