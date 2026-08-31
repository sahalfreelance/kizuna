# Riwayat versi worker: v6 → v10

Satu halaman, urut versi. Detail lengkap ada di `CHANGELOG.md`.

Semua angka di bawah hasil ukur di VPS 2 vCPU / 2GB, bukan perkiraan.

---

## v6 — Job paralel + heartbeat + kunci nonce

Masalah: ACO mengantre kalau dipakai beberapa user atau >1 slug.

**A. Antrean.** `await processJob(job)` memblokir sampai job selesai — dan job
menunggu window mint bisa berjam-jam. Job lain tertahan QUEUED sampai kelewat.
Sekarang tidak di-`await`, dilacak di `Map`.

Urutan klaim juga salah: `created_at` → job yang mint 6 jam lagi bisa menang dari
job yang mint 10 menit lagi. Diganti `stage_start_time`.

Klaim dipindah ke fungsi Postgres `aco_claim_job` (`for update skip locked`).

**B. Job sah dibunuh.** Cutoff 30 menit membunuh job yang sedang menunggu window
jauh. Artinya jadwal mint >30 menit ke depan **mustahil berhasil**. Diganti
`heartbeat_at` tiap 30 detik; mati kalau sunyi 3 menit.

**C. Nonce tabrakan.** Dua job satu wallet baca nonce pending yang sama → tx
kedua menimpa yang pertama, gas tetap kebakar. `lib/walletLock.js` mutex per
address.

Bug ketemu saat uji: kunci bocor (52 entri dari 50 operasi) karena
`.then()` bikin promise baru tiap dipanggil → perbandingan pembersihan selalu
false.

Bug hampir fatal: probe `--check` versi pertama memanggil `aco_claim_job`
sungguhan — bisa **mencuri job worker yang sedang jalan**. Diganti cek kolom.

```
sequential  A=632ms B=762ms KELEWAT C=943ms KELEWAT  → 2/3 kelewat
paralel     A=631ms B=131ms        C=181ms           → 0/3 kelewat
```

---

## v7 — Batas konkurensi dipindah ke fase mint

Pertanyaan lu: "kalau batasnya 8, 20 orang barengan berarti 12 nunggu?"
Jawabannya iya, dan **batas 8 itu salah tempat**.

```
[============ menunggu window ============][mint]
        berjam-jam, beban ~0                ~3 detik
```

`MAX_CONCURRENT_JOBS = 8` membatasi SELURUH baris itu. Slot dipegang selama fase
menunggu, jadi user ke-9 bukan menunggu beban lewat — dia menunggu job orang lain
**selesai sepenuhnya**.

- `MAX_CONCURRENT_JOBS` → default **0 = tanpa batas**
- `lib/semaphore.js` + `MAX_CONCURRENT_MINTS` membungkus **hanya fase mint**

```
batas-di-job (lama)   10/20 kelewat, telat terburuk 484ms
batas-di-mint (baru)   0/20 kelewat, telat terburuk 1ms
20 stage buka detik SAMA: 20/20 selesai, nunggu ~122ms
```

---

## v8 — Batas dinaikkan berdasarkan pengukuran

Pertanyaan lu: apakah proxy DataImpulse bisa mengatasi rate limit.

Rate limit diukur langsung:

```
 5 bersamaan → 429:0     30 bersamaan → 429:0
12 bersamaan → 429:0     50 bersamaan → 429:0
20 bersamaan → 429:0     80 bersamaan → 429:0
```

**Nol 429.** Batas 6 dari v7 itu tebakan gw dari satu baris log — menghambat
tanpa alasan.

**429 lu itu fingerprint, bukan volume:**

```
header minimal   → 429 di request PERTAMA
+ user-agent     → 200
```

Kalau pemicunya fingerprint, ganti IP tidak menyembuhkan apa pun.

```
MAX_CONCURRENT_MINTS   6 → 16
gql.opensea.io      8/s → 25/s (burst 50)
api.opensea.io      tetap 4/s   (REST resmi, batasnya nyata)
```

Proxy ditolak untuk jalur mint (kesimpulan ini direvisi di v9, diselesaikan di
v10).

---

## v9 — Uji beban 50 user + api key diperiksa

Pertanyaan lu: (a) apakah 429 karena api key belum dipakai, (b) bisa 50 orang
bersamaan dengan worker masing-masing.

### API key tidak dibaca di gql.opensea.io

```
header worker (tanpa api-key)   → 200
+ x-api-key NGAWUR              → 200
TANPA user-agent                → 429 (9ms)
```

Key palsu tetap dilayani 200. Kalau diperiksa, harus 401. Jadi `gql.opensea.io`
mengabaikan `x-api-key` — autentikasinya **cookie SIWE**.

Bandingkan `api.opensea.io` yang memang memeriksa:

```
-key → 401 "Missing an API Key"    +key → 401 "Invalid API key"
```

Api key sudah terpasang benar di `lib/auth.js`, `lib/eligWorker.js`,
`lib/itemDetail.js`, `worker.js:493`. Tidak ada perubahan kode.

Budget ketemu di response: `"x-ratelimit-remaining": 399` — tetap 399 setelah 8
request unik.

### 50 user: BISA, satu worker cukup

```
50 job hammer (250 request)  → 200:250 · 429:0 · p99 1141ms · RSS 92 MB
RPC publicnode 50 bersamaan  → base/ethereum/robinhood 50/50
CPU tanda tangan tx 1.64ms   → rasio CPU : tunggu = 1 : 1220
50 job idle                  → 89 MB (~0.58 MB/job) · event loop lag 0ms
```

Fase mint itu **menunggu jaringan, bukan menghitung** — 2 vCPU bukan pembatas.
50 worker terpisah justru butuh ~4 GB; VPS 2 GB tidak cukup. Jadi "worker
masing-masing" bukan cuma tidak perlu, itu yang bikin tidak jalan.

`MAX_CONCURRENT_MINTS`: 16 → 50.

**Temuan sampingan:** `base.llamarpc.com` dan `base.blockpi.network` gagal 50/50
(HTTP 521). Bukan default Kizuna, tapi jadi titik lemah kalau member memakainya
sebagai custom RPC.

### Koreksi v8

```
total 781ms · server 6.7ms · overhead edge ~774ms
```

Backend OpenSea jawab **6.7ms**. v8 menyimpulkan "828ms itu OpenSea memproses" —
salah. Kontrol dari VPS yang sama: cloudflare 32ms, google 21ms,
api.opensea.io 106ms.

---

## v10 — Skala 200 user + hammer pipeline

Target lu naik ke 200 user, plus minta 774ms dikejar.

### 774ms: semua hipotesis diuji, semuanya salah

```
cache HIT (age=0)             759ms   ← yang di-cache pun tetap lambat
cache MISS                    824ms
cookie __cf_bm dipakai ulang  750ms   (beda cuma 39ms)
keep-alive, socket reuse      737ms   (tls=0ms)
koneksi baru tiap request     791ms
HTTP/1.1 / HTTP/2         747 / 789ms
body 0 byte / 8KB         795 / 767ms
```

Bukan TLS, cache, bot management, ukuran body, versi HTTP, atau bikin koneksi.

**Petunjuk yang menentukan** — host yang SAMA:

```
GET  /graphql        255ms
GET  /404-ngawur     257ms
POST /graphql        762ms
POST body RUSAK      740ms   ← tidak pernah sampai GraphQL, tetap 740ms
OPTIONS /graphql     787ms
```

POST body rusak (langsung 400) tetap 740ms → ~500ms terjadi **sebelum** request
diproses. Penalti khusus method POST di edge OpenSea.

Kontrol: `POST api.github.com/graphql` dari VPS yang sama = **11ms**.

**774ms tidak bisa dihilangkan dari sisi kita.** Itu infrastruktur OpenSea,
berlaku sama untuk semua bot di endpoint itu. Ini juga menutup pertanyaan proxy
secara final: proxy tidak mengubah penalti method POST.

### Yang bisa diperbaiki: frekuensi menabrak 774ms

Pola hammer lama jauh lebih lambat dari yang tertulis di kode:

```
kirim → tunggu 780ms → jeda 200ms → kirim → ...
jarak NYATA antar percobaan: 1015ms
```

`retryDelayMs: 200` menyesatkan — 780ms latensi ikut terhitung. Kalau stage buka
tepat setelah satu percobaan gagal, deteksinya telat 1 detik penuh.

`lib/graphqlPipeline.js` (BARU): tembak tiap 200ms **tanpa menunggu jawaban**.

```
                jarak kirim    telat deteksi
cara lama         1015ms          508ms
pipeline           201ms          101ms
                              → −407ms
```

407ms di detik yang paling menentukan, tanpa menyentuh 774ms.

Dijaga: begitu ada yang sukses pengiriman berhenti; hard error per address tetap
dicatat; request yang sudah melayang hasilnya dibuang. Matikan dengan
`HAMMER_PIPELINE=false`.

### 200 user

```
gelombang terkendali        berkelanjutan
 25 → p50  908ms             25 req/s × 4s → p50 769ms · melayang 21
 50 → p50  875ms             50 req/s × 4s → p50 773ms · melayang 43
 75 → p50  867ms            100 req/s × 4s → p50 766ms · melayang 79
100 → p50  948ms
150 → p50  999ms            semua 429:0
200 → p50 1079ms
```

25 → 200 cuma menambah 171ms. 100 req/s berkelanjutan tidak menaikkan latensi
sama sekali.

**Batas yang ketemu:**

```
200 job hammer PIPELINE serentak (800 request, 800 melayang):
  795/800 sukses · 429:0 · 5 error jaringan · RSS 210 MB
  TAPI p50 melonjak 780ms → 3641ms (4.7x)
```

Yang jebol **bukan OpenSea** (nol 429) — yang jebol event loop worker: 800
request melayang berebut satu thread. Karena itu batas fase mint tetap ada.

```
MAX_CONCURRENT_MINTS     50 → 200
gql.opensea.io   25/s burst 50 → 120/s burst 240
opensea.io             10/s → 20/s
```

Batas 25/s adalah penghambat fatal untuk 200 user: hammer 5 tembakan/detik × 200
job = ~1000 req/s, dan 25/s menumpuk antrean **40 detik** — mint dijamin kelewat.

### Verifikasi terakhir: 20 orang slug sama, window sama

Diuji dengan `Semaphore` + `walletLock` ASLI dari worker:

```
20 user, slug SAMA "jaconlab", window SAMA:
  tunggu semaphore max : 1ms
  tunggu kunci wallet  : 1ms
  sebaran mulai mint   : 1ms
  job selesai          : 20/20
  → TIDAK ada antrean
```

Kunci itu **alamat wallet**, bukan slug — 20 user = 20 wallet = 20 kunci beda.

Kontrol (satu wallet dipakai 2 job, HARUS berantre):

```
A mulai 0ms → A selesai 301ms → B mulai 301ms → B selesai 602ms
```

Itu disengaja: tanpa itu dua tx ambil nonce sama dan satu menimpa yang lain.

---

## Ringkas angka per versi

```
versi   fase mint    gql rate        pola hammer      catatan
v6      8 (job)      8/s             berurutan        job paralel + heartbeat
v7      6 (mint)     8/s             berurutan        batas pindah ke fase mint
v8      16           25/s  burst 50  berurutan        rate limit diukur
v9      50           25/s  burst 50  berurutan        50 user terbukti
v10     200          120/s burst 240 PIPELINE         200 user + hammer −407ms
```

## Yang perlu dijalankan di database

Cuma satu, dan cuma kalau belum pernah:

```
supabase/migration_aco_parallel.sql
```

Isinya kolom `heartbeat_at`/`worker_id` + fungsi `aco_claim_job` dan
`aco_release_dead_jobs` (dari v6). v7-v10 **tidak menambah migration apa pun**.

Kalau belum dijalankan, worker tetap hidup tapi jatuh ke mode SEQUENTIAL dan
pembersihan job mati dilewati — sengaja, bukan crash.

## Yang belum terverifikasi (lintas versi)

- **Semua uji beban pakai query ringan tanpa cookie.** Terbukti: 200 koneksi
  paralel dan 100 req/s berkelanjutan bukan masalah. Belum: apakah request
  ber-cookie SIWE punya batas berbeda.
- **Pipeline belum diuji dengan mint sungguhan** — baru mock dengan latensi 780ms
  disimulasikan. Di mint pertama, perhatikan nomor di
  `[GQL] ✅ Got calldata on attempt N` — harusnya lebih kecil dari biasanya.
- **Rate 120/s belum diuji berkelanjutan** — hasil ukur mentok di 100/s, 120
  adalah ekstrapolasi.
- **200 SIWE login bersamaan** — butuh 200 private key member.
- **Dua worker berbagi database** — jaminan `for update skip locked`, belum diuji.
  Kalau dipakai: `WORKER_ID` harus beda, dan dua worker **tidak boleh** berbagi
  wallet yang sama (`walletLock` mutex in-process, tidak melihat proses lain).
- **Fungsi Postgres belum pernah dieksekusi Postgres** — typo SQL baru ketahuan
  saat lu jalankan migration.
- **Gambar NFT tampil sungguhan** — butuh API key member.
- **Alasan pasti penalti POST 500ms** — terbukti ada dan konsisten, tapi
  penyebabnya di sisi OpenSea dan tidak terlihat dari luar.

## Kalau member benar-benar 200

`app/api/aco/jobs/route.js:7` — `MAX_ACTIVE_JOBS = 3`. Dengan 200 member itu
sampai 600 job aktif. Worker sanggup menampung (job menunggu ~0.58 MB), tapi
kalau 600 masuk fase mint serentak, p50 melonjak seperti uji 800 request di v10.

Kalau itu terjadi: turunkan ke 2, atau tambah worker kedua.
