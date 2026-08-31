# Riwayat perubahan

Ringkas per tahap: apa yang berubah, dan kenapa.

---

## 1. Login username + password

Discord OAuth dibuang (9 file, `next-auth` dicabut). Password scrypt, sesi token
HMAC stateless, 1 user 1 device via UNIQUE partial index.

**Ketemu:** `node:crypto` tidak ada di Edge runtime (middleware jalan di Edge) —
akan gagal setelah deploy, semua orang tidak bisa login. Dibuat `sessionEdge.js`
pakai Web Crypto. Timing attack ditutup padding 120ms. Race condition bind device
ditutup guard `.is("device_id", null)`.

---

## 2. ACO — arsitektur

Website = panel kontrol, worker VPS = eksekutor. Vercel function maks 300s, cron
Hobby 1×/hari ±59 menit — tidak mungkin mengejar mint jam 14:30:00.

**Ketemu:** `auth.js` throw di top-level; `ethers` belum ada di package.json;
`WebSocketProvider` kebocoran socket.

---

## 3. Multi-chain + custom RPC

**Ketemu:** SSRF (RPC URL user dihubungi server, bisa memindai jaringan internal
VPS). Chain id RPC tidak diverifikasi. RPC Ronin default 403.

---

## 4. API key OpenSea per user

`429 Maximum 2 keys per day` — **per IP**. Diminta dari browser user. Umur dicek
tiap login, diganti hari ke-21 dari 30.

---

## 5. Anti-revert, auto-retry, anti rate-limit

Preflight: stage buka → saldo → `eth_call` → `estimateGas`. RPC bermasalah →
simulasi dilewati, tx tetap dikirim.

Retry: `RATE_LIMIT`/`RPC_DOWN` diulang + pindah RPC. `TX_SENT_UNKNOWN` tidak
pernah diulang.

**Ketemu:** `"wallet not eligible for this stage"` salah diklasifikasi `NOT_LIVE`.

---

## 6. Mintbay ditambahkan

Sebelumnya cuma Scatter — salah tangkap. Jadi 4 tab.

---

## 7. Robinhood Chain + batas 2 wallet

chainId 4663, dikonfirmasi dari API OpenSea. `MAX_WALLETS_PER_USER` 20 → 2.

---

## 8. Eligibility checker + fix login SIWE

**Bug login:** `headers.raw()` cuma ada di node-fetch; setelah diganti undici,
`headers.get("set-cookie")` menggabungkan semua Set-Cookie jadi satu string dan
parser cuma ambil yang pertama — `access_token` tidak pernah terbaca. Diperbaiki
pakai `getSetCookie()`.

**Checker:** field eligibility dikunci di balik auth, jadi harus SIWE login —
hanya bisa di worker. Label `ELIGIBLE 2/2` + rincian per wallet. `unknown`
dibedakan dari `not eligible`.

---

## 9. Job jalan selama stage masih buka + checker dipercepat

Job digagalkan kalau waktu **buka** lewat > 5 menit — salah, selama stage masih
OPEN mint masih bisa. Yang menentukan sekarang waktu **TUTUP**.

Checker ~7s → ~1-2s: login paralel, query paralel, polling worker 5000→700ms,
browser 1000→400ms, cache session 20 menit. Session dipakai bersama checker ↔
mint + pemanasan 90 detik sebelum window.

---

## 10. Konfirmasi on-chain + galeri item + dialog bertema

Log user melaporkan `0/1 berhasil` padahal tx-nya **status 1 SUKSES, 2 token
masuk** (dibaca langsung dari Robinhood Chain, block 49464109). Yang gagal cuma
pembacaan status dari OpenSea karena 429.

`waitForMintStatus()` (OpenSea) → `confirmOnChain()` (receipt). OpenSea sekarang
cuma untuk nama & gambar, setelah status pasti.

**Ketemu:** contract address OpenSea (`0x5cae…328e`) berbeda dari kontrak yang
me-mint (`0x4997…5390`) — normal di SeaDrop. Filter ketat = 0 token padahal 2
masuk, jadi filter dijadikan preferensi dengan fallback.

Galeri item + dialog konfirmasi bertema (`window.confirm` memblokir thread JS,
jadi log realtime berhenti selama dialog terbuka).

---

## 11. Job paralel + heartbeat + kunci nonce

User bertanya apakah ACO mengantre saat dipakai beberapa user atau saat satu user
menjadwalkan lebih dari 1 slug. Jawabannya iya, dan ada 3 masalah.

### Masalah A: antrean

```js
const job = await claimNextJob();
if (job) await processJob(job);   // memblokir sampai selesai
```

`processJob` menunggu window mint (bisa berjam-jam), jadi job lain tertahan di
QUEUED sampai kelewat.

Perbaikan: `processJob` tidak di-`await`. Urutan pengambilan juga salah: dulu
`created_at`, jadi job yang mau mint 6 jam lagi bisa menang dari job yang mau
mint 10 menit lagi. Sekarang `stage_start_time`.

Klaim dipindah ke fungsi Postgres `aco_claim_job` dengan `for update skip
locked`. Ada fallback ke cara lama kalau migration belum dijalankan.

### Masalah B: job dibunuh saat menunggu

```js
// CLAIMED/RUNNING lebih tua dari 30 menit -> FAILED "job nyangkut"
```

Job sah yang menunggu window 6 jam ke depan ikut dibunuh. Artinya menjadwalkan
mint > 30 menit di depan **tidak pernah bisa berhasil**.

Perbaikan: kolom `heartbeat_at` + `startHeartbeat()` tiap 30 detik.
`aco_release_dead_jobs` hanya membunuh job tanpa kabar 3 menit. Kalau migration
belum ada, pembersihan **dilewati sepenuhnya** — bukan jatuh ke cara lama, karena
cara lama justru merusak.

### Masalah C: dua job, satu wallet

Keduanya membaca nonce "pending" yang sama, tx kedua **menimpa** tx pertama —
satu mint hilang, gas terbakar. `lib/walletLock.js`: mutex in-process per
address, membungkus ambil-nonce sampai kirim-tx.

**Bug saat menguji:** kunci bocor, 52 entri tersisa setelah 50 operasi.
Penyebabnya `locks.get(key) === prev.then(...)` — `.then()` membuat promise BARU
tiap dipanggil, jadi perbandingannya selalu false.

### Probe `--check` yang hampir merusak

Versi pertama memeriksa kesiapan dengan **memanggil `aco_claim_job`** — fungsi
itu benar-benar mengklaim job, jadi `--check` bisa mencuri job worker yang sedang
jalan. Diganti: memeriksa keberadaan kolom.

---

## 12. Batas konkurensi dipindah ke fase mint

User bertanya: kalau batasnya 8, berarti 20 user barengan bikin 12 orang
mengantre? **Pertanyaannya benar dan batas 8 itu salah tempat.**

```
[============ menunggu window ============][mint]
        berjam-jam, beban ~0                ~3 detik
```

`MAX_CONCURRENT_JOBS = 8` membatasi SELURUH baris itu. Slot dipegang selama fase
menunggu, jadi user ke-9 menunggu job orang lain **selesai sepenuhnya**. Itu
antrean, bukan pembatasan beban.

- `MAX_CONCURRENT_JOBS` default **0 = tanpa batas**.
- `lib/semaphore.js` + `MAX_CONCURRENT_MINTS` membungkus **hanya fase mint**.

```
batas-di-job (lama)   10/20 kelewat, telat terburuk 484ms
batas-di-mint (baru)   0/20 kelewat, telat terburuk 1ms
terburuk (20 stage buka detik yang sama): 20/20 selesai, nunggu ~122ms
```

---

## 13. Batas dinaikkan berdasarkan pengukuran

User bertanya apakah proxy DataImpulse bisa mengatasi rate limit. Rate limit
`gql.opensea.io` diukur langsung: 5/12/20/30/50/80 bersamaan → **nol 429**.
`MAX_CONCURRENT_MINTS = 6` dari tahap 12 menghambat tanpa alasan.

**429 itu fingerprint, bukan volume:**

```
header minimal        → 429 di request PERTAMA
+ user-agent          → 200
```

Perubahan: `MAX_CONCURRENT_MINTS` 6 → 16, rate 8/s → 25/s.

Proxy ditolak untuk jalur mint (latensi jaringan cuma 3ms, proxy menambah
100-500ms) — kesimpulan ini direvisi di tahap 14 lalu diselesaikan di tahap 15.

---

## 14. Uji beban 50 user + api key diperiksa

### API key tidak dibaca di gql.opensea.io

```
header worker (tanpa api-key)      → 200
+ x-api-key NGAWUR                 → 200
TANPA user-agent                   → 429 (9ms)
```

Key palsu tetap 200. Kalau key diperiksa, harus 401. Jadi `gql.opensea.io`
mengabaikan `x-api-key` — autentikasinya **cookie SIWE**.

Bandingkan `api.opensea.io` yang memang memeriksa:

```
-key → 401 "Missing an API Key"   +key → 401 "Invalid API key"
```

Api key sudah terpasang benar di `lib/auth.js`, `lib/eligWorker.js`,
`lib/itemDetail.js`, `worker.js:493`. Tidak ada perubahan kode.

Budget juga ditemukan di response: `"x-ratelimit-remaining": 399` — tetap 399
setelah 8 request unik.

### 50 user: BISA, satu worker cukup

```
50 job hammer (250 request) → 200:250 · 429:0 · p99 1141ms · RSS 92 MB
RPC publicnode 50 bersamaan → base/ethereum/robinhood 50/50
CPU: tanda tangan tx 1.64ms → rasio CPU:tunggu = 1 : 1220
50 job idle: 89 MB (~0.58 MB/job) · event loop lag 0ms
```

Fase mint itu menunggu jaringan, bukan menghitung, jadi 2 vCPU bukan pembatas.
50 worker terpisah justru butuh ~4 GB — VPS 2 GB tidak cukup.

`MAX_CONCURRENT_MINTS`: 16 → 50.

**Temuan sampingan:** `base.llamarpc.com` dan `base.blockpi.network` gagal 50/50
(HTTP 521). Bukan default Kizuna, tapi jadi titik lemah kalau dipakai member
sebagai custom RPC.

### Koreksi tahap 13

```
total 781ms · server 6.7ms · overhead edge ~774ms
```

Backend OpenSea jawab **6.7ms**. Tahap 13 menyimpulkan "828ms itu OpenSea
memproses" — salah. Kontrol dari VPS yang sama: cloudflare 32ms, google 21ms,
api.opensea.io 106ms.

---

## 15. Skala 200 user + 774ms dilacak sampai habis

User menaikkan target dari 50 ke **200 user** dan minta 774ms dikejar.

### 774ms: semua hipotesis diuji, semuanya salah

```
cache HIT (age=0)             759ms   ← bahkan yang di-cache tetap lambat
cache MISS                    824ms
cookie __cf_bm dipakai ulang  750ms   (selisih cuma 39ms)
keep-alive, socket reuse      737ms   (tls=0ms, tetap lambat)
koneksi baru tiap request     791ms
HTTP/1.1 / HTTP/2             747 / 789ms
body 0 byte / 8KB             795 / 767ms
```

Bukan TLS, cache, bot management, ukuran body, versi HTTP, atau pembuatan
koneksi.

**Petunjuk yang menentukan** — host yang SAMA:

```
GET  /graphql        255ms
GET  /404-ngawur     257ms
POST /graphql        762ms
POST body RUSAK      740ms   ← tidak pernah sampai GraphQL, tetap 740ms
OPTIONS /graphql     787ms
```

POST dengan body rusak (langsung 400) tetap 740ms. Jadi ~500ms terjadi
**sebelum** request diproses — penalti khusus method POST di edge OpenSea.

Kontrol: `POST api.github.com/graphql` dari VPS yang sama = **11ms**. Jadi POST
dari VPS ini tidak lambat secara umum.

**Kesimpulan: 774ms tidak bisa dihilangkan dari sisi kita.** Itu perilaku
infrastruktur OpenSea dan berlaku sama untuk semua bot yang memakai endpoint itu.
Ini juga menutup pertanyaan proxy dari tahap 13 secara final: proxy tidak
mengubah penalti method POST.

### Yang bisa diperbaiki: frekuensi menabrak 774ms

Pola lama:

```
kirim → tunggu 780ms → jeda 200ms → kirim → ...
jarak nyata antar percobaan: 1015ms   (bukan 200ms seperti yang diniatkan)
```

`retryDelayMs: 200` menyesatkan — 780ms latensi ikut dihitung. Kalau stage buka
tepat setelah satu percobaan gagal, deteksinya telat sampai 1 detik penuh.

`lib/graphqlPipeline.js` (BARU): tembakan dikirim tiap `retryDelayMs` **tanpa
menunggu jawaban sebelumnya**.

```
                    jarak kirim    telat deteksi rata-rata
cara lama             1015ms              508ms
pipeline               201ms              101ms
                                    → lebih cepat ~407ms
```

407ms di detik yang paling menentukan, tanpa menyentuh 774ms.

Yang dijaga: begitu ada yang sukses, pengiriman berhenti; hard error per address
tetap dicatat; request yang sudah melayang hasilnya dibuang. Bisa dimatikan
dengan `HAMMER_PIPELINE=false`.

### 200 user

```
gelombang terkendali
   25 → p50  908ms      100 → p50  948ms
   50 → p50  875ms      150 → p50  999ms
   75 → p50  867ms      200 → p50 1079ms   (semua 429:0 err:0)

berkelanjutan
   25 req/s × 4s → p50 769ms · melayang 21
   50 req/s × 4s → p50 773ms · melayang 43
  100 req/s × 4s → p50 766ms · melayang 79   (semua 429:0)
```

Naik dari 25 ke 200 cuma menambah 171ms. 100 req/s berkelanjutan tidak menaikkan
latensi sama sekali.

**Batas yang ketemu:**

```
200 job hammer PIPELINE serentak (800 request, 800 melayang):
  795/800 sukses · 429:0 · 5 error jaringan · RSS 210 MB
  TAPI p50 melonjak 780ms → 3641ms (4.7x)
```

Yang jebol **bukan OpenSea** — nol 429. Yang jebol event loop worker: 800 request
melayang berebut satu thread. Karena itu batas fase mint tetap ada.

Perubahan:

```
MAX_CONCURRENT_MINTS      50 → 200
gql.opensea.io rate    25/s burst 50 → 120/s burst 240
opensea.io rate        10/s → 20/s
```

Batas 25/s adalah penghambat fatal untuk 200 user: dengan hammer 5
tembakan/detik per job, 200 job butuh ~1000 req/s — batas 25/s menumpuk antrean
**40 detik**, mint dijamin kelewat.

Uji mock pipeline (latensi 780ms disimulasikan):

```
✓ menang saat stage buka 1200ms        selesai 1409ms
✓ jarak kirim ~200ms                   rata-rata 201ms · 7 tembakan
✓ berhenti menembak setelah menang     0 tembakan setelah sukses
✓ semua gagal → throw, tidak hang      1231ms
```

---

## Hasil tes kumulatif

```
774ms dilacak
  cache HIT tetap 759ms · keep-alive tetap 737ms · h1 vs h2 sama ✓
  GET 255ms vs POST 762ms di host sama ✓
  POST body rusak tetap 740ms (bukan pemrosesan) ✓
  kontrol POST api.github.com 11ms (VPS tidak lambat) ✓

hammer pipeline
  jarak kirim 1015ms → 201ms ✓
  telat deteksi 508ms → 101ms (−407ms) ✓
  mock: menang attempt 4, 0 tembakan sia-sia, throw saat habis ✓

skala 200 user
  gelombang 25/50/75/100/150/200 → semua 429:0 err:0 ✓
  berkelanjutan 100 req/s × 4s → p50 766ms, nol 429 ✓
  200 job pipeline → 795/800, RSS 210 MB, p50 3641ms (batas ketemu) ✓

skala 50 user
  50 job hammer → 250× 200, p99 1141ms, RSS 92 MB ✓
  RPC publicnode 50 bersamaan → base/ethereum/robinhood 50/50 ✓
  CPU per mint 1.64ms · rasio CPU:tunggu 1:1220 ✓

api key
  gql.opensea.io: key ngawur → 200 (tidak dibaca) ✓
  api.opensea.io: -key "Missing" vs +key "Invalid" (dibaca) ✓

semaphore (fase mint)     5 kasus ✓
simulasi 20 user          batas-di-job 10/20 kelewat vs batas-di-mint 0/20 ✓
kunci per wallet          5 kasus ✓ (50 operasi → 0 entri, tidak bocor)
simulasi loop paralel     sequential 2/3 kelewat vs paralel 0/3 ✓
tx SUNGGUHAN user         status 1 SUKSES, 2 token, block 49464109 ✓
extractMintedTokens       9 kasus ✓
explorerTxUrl             7 chain ✓
logika window             6/6 ✓
SIWE login                access_token JWT valid ✓
decideEligible            9/9 ✓
enkripsi                  roundtrip ✓ tamper ditolak ✓ web↔worker ✓
klasifikasi error         12/12 ✓
RPC pool (mainnet)        failover ✓ chain salah ditolak ✓
chain                     13/13 RPC ✓ 13/13 identifier ✓
endpoint tanpa auth       7/7 → 401 ✓
window.confirm tersisa    0 ✓
build                     ✓ Compiled successfully
worker --check            Kizuna ACO Worker v10 ✓
syntax semua JS           0 gagal
```

### Yang tidak bisa diuji dari sini

- **Semua uji beban pakai query ringan tanpa cookie.** Terbukti: 200 koneksi
  paralel dan 100 req/s berkelanjutan bukan masalah. Belum: apakah request
  ber-cookie SIWE punya batas berbeda.
- **Pipeline belum diuji dengan mint sungguhan** — baru mock. Yang perlu dilihat
  di mint pertama: `[GQL] ✅ Got calldata on attempt N` dengan N lebih kecil.
- **200 SIWE login bersamaan** — butuh 200 private key member.
- **Rate 120/s belum diuji berkelanjutan** — hasil ukur mentok di 100/s.
- **Dua worker berbagi database** — jaminan `skip locked`, belum diuji.
- **Fungsi Postgres belum pernah dieksekusi.**
- **Gambar NFT tampil sungguhan** — butuh API key member.
- **Nilai `isEligible` sungguhan** — semua koleksi yang dicoba `drop`-nya `null`.
- **Alasan pasti penalti POST 500ms** — terbukti ada dan konsisten, tapi
  penyebabnya di sisi OpenSea dan tidak terlihat dari luar.

---

## 16. Card feed dirapikan

Tiga perubahan tampilan di halaman overview.

**Tombol rata bawah.** Card punya tinggi isi berbeda (judul 1 baris vs 3 baris),
jadi tombolnya naik-turun tidak simetris. Diperbaiki tanpa mengukur tinggi di JS:

```js
// GarapanCard.js — pada container card
height: "100%",
// pada blok meta (@user + tanggal)
marginTop: "auto",
```

`height:100%` membuat card mengisi tinggi baris grid, `marginTop:auto` mendorong
meta + tombol ke dasar. Grid `auto-fill minmax(290px, 1fr)` yang sudah ada bikin
semua card satu baris setinggi yang tertinggi, jadi tombolnya sejajar.

**Deskripsi dihilangkan.** Card sekarang hanya gambar, kategori, judul, meta, dan
tombol. Yang ikut hilang karena tidak lagi terpakai:

- state `expanded` + tombol `lihat selengkapnya ▾` / `▴ tampilkan lebih sedikit`
- `linkifyDescription()` dan `URL_REGEX`
- perhitungan `isLong` / `lineCount` / `showExpandButton`

Tombolnya juga jadi konsisten: dulu bisa jadi `lihat selengkapnya` ATAU
`./open_link.sh →` tergantung panjang teks — sekarang selalu `./open_link.sh →`.

Kolom `description` **tidak dihapus** dari database maupun form admin, cuma tidak
ditampilkan di card. `AlphaCard.js` (halaman `/alpha`) tidak disentuh.

**Judul overview:** `Rangkuman garapan komunitas` → `Welcome To Kizuna`
(`components/Dashboard.js`).

Build: `✓ Compiled successfully`.

---

## 17. Penjelasan di halaman ACO dipangkas

Halaman ACO penuh teks penjelasan panjang. Semua dibuang atau dipendekkan jadi
label singkat — kecuali dua hal yang menyangkut kehilangan uang.

Yang **dihapus total**:

- footnote API key ("tiap user punya key sendiri supaya rate limit…", 3 baris)
- penjelasan RPC publik vs custom (3 baris)
- footnote "RPC disimpan terenkripsi…" (3 baris)
- footnote "job masuk antrean, browser boleh ditutup" (2 baris)
- subtitle halaman "Anti-revert · auto-retry · anti rate-limit…" (2 baris)
- daftar 5 fitur "yang sudah siap dipakai bersama nanti" di panel platform SOON
- `platform.description` di panel platform SOON

Yang **dipendekkan**:

```
sebelum                                          sesudah
Belum ada API key. Tekan refresh untuk         → Belum ada API key — tekan refresh.
membuatnya — key diminta dari browser
kamu, jadi tidak berebut kuota…

Kuota pembuatan key OpenSea habis (2 per      → Kuota key habis (2/hari per IP).
hari dari IP kamu). Coba lagi besok — key        Coba lagi besok.
lama tetap dipakai kalau masih berlaku.

Anti-revert — simulasi tx dulu (eth_call).    → Anti-revert — simulasi tx dulu
Kalau diperkirakan gagal, tx tidak dikirim
dan gas tidak terbuang. Matikan hanya…

percobaan. Error sementara (RPC mati, rate    → percobaan
limit, stage belum buka) diulang otomatis…

Worker belum merespons dalam 30 detik. Cek    → Worker tidak merespons (30s).
worker di VPS jalan atau tidak (pm2 logs…)
```

### Dua peringatan tetap ada

Dipendekkan, tidak dihapus — keduanya soal uang yang tidak bisa dikembalikan:

```js
// import wallet
"PAKAI WALLET BURNER"
"Key dienkripsi, tapi admin server tetap bisa mengaksesnya.
 Jangan pakai wallet utama."

// batal job yang sedang diproses
"Sedang diproses. Tx yang sudah terkirim tidak bisa ditarik."

// hapus wallet
"Private key dihapus permanen. Tidak bisa dipulihkan."
```

Alasannya: user yang menempel private key wallet utamanya karena tidak ada
peringatan kehilangan uang sungguhan, dan itu tidak bisa di-undo. Sisanya cuma
teks yang bisa dibaca ulang kapan saja.

`AcoDashboard.js`: 1902 → 1832 baris. Build: `✓ Compiled successfully`.
