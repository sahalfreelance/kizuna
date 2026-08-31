# Kizuna — paket final

Login username+password, ACO multi-platform, eligibility checker, worker VPS.
Struktur folder sudah sama dengan repo — tinggal `cp -r`.

Menggantikan semua zip sebelumnya. 76 file, tanpa `.env`/`node_modules`.

Worker naik ke **v10**. Tidak ada migration baru.

Riwayat versi **v6 → v10** ada di `VERSI_v6_ke_v10.md` (satu halaman, urut versi).
Detail teknis lengkap tiap tahap ada di `CHANGELOG.md`.

---

## Ringkas: 200 user BISA, dan hammer dipercepat ~407ms

Dua perubahan, dua-duanya dari hasil ukur.

### 1. Batas dinaikkan ke 200

```
MAX_CONCURRENT_MINTS   : 50  → 200
gql.opensea.io rate     : 25/s burst 50 → 120/s burst 240
```

Batas 25/s itu penghambat fatal untuk 200 user. Dengan hammer 5 tembakan/detik
per job, 200 job butuh ~1000 req/s — batas 25/s menumpuk antrean **40 detik**.
Mint dijamin kelewat.

### 2. Hammer pipeline (yang mengurus 774ms)

`lib/graphqlPipeline.js` (BARU). Ini perbaikan paling berdampak di paket ini.

---

## Hasil ukur 200 user

### Gelombang terkendali

```
 25 bersamaan → p50  908ms  429:0 err:0
 50 bersamaan → p50  875ms  429:0 err:0
 75 bersamaan → p50  867ms  429:0 err:0
100 bersamaan → p50  948ms  429:0 err:0
150 bersamaan → p50  999ms  429:0 err:0
200 bersamaan → p50 1079ms  429:0 err:0
```

Naik dari 25 ke 200 cuma menambah **171ms**. Tidak ada titik rusak.

### Beban berkelanjutan (yang relevan untuk hammer)

```
 25 req/s × 4s → p50 769ms · melayang puncak 21 · 429:0
 50 req/s × 4s → p50 773ms · melayang puncak 43 · 429:0
100 req/s × 4s → p50 766ms · melayang puncak 79 · 429:0
```

100 req/s berkelanjutan **tidak menaikkan latensi sama sekali**.

### Batas yang ketemu

```
200 job hammer PIPELINE serentak (800 request, 800 melayang):
  795/800 sukses · 429:0 · 5 error jaringan · RSS 210 MB
  TAPI p50 melonjak 780ms → 3641ms (4.7x)
```

Yang jebol **bukan OpenSea** — nol 429. Yang jebol event loop worker: 800
request melayang berebut satu thread. Karena itu batas 200 tetap ada; 200 job
boleh hidup bersamaan, tapi fase mint dibatasi supaya request melayang tidak
meledak.

---

## Soal 774ms: sudah ditemukan, tapi bukan yang disangka

Semua hipotesis diuji dan **semuanya salah**:

```
cache HIT (age=0)             759ms   ← bahkan yang di-cache tetap lambat
cache MISS                    824ms
cookie __cf_bm dipakai ulang  750ms   (selisih cuma 39ms)
keep-alive, socket reuse      737ms   (tls=0ms, tetap lambat)
koneksi baru tiap request     791ms
HTTP/1.1                      747ms
HTTP/2                        789ms
body 0 byte                   795ms
body 8KB                      767ms
```

Bukan TLS, bukan cache, bukan bot management, bukan ukuran body, bukan versi
HTTP, bukan pembuatan koneksi.

**Petunjuk yang menentukan** — di host yang SAMA:

```
GET  /graphql        255ms
GET  /404-ngawur     257ms
POST /graphql        762ms
POST body RUSAK      740ms   ← tidak pernah sampai GraphQL, tetap 740ms
OPTIONS /graphql     787ms
```

POST dengan body rusak (langsung 400) tetap 740ms. Jadi ~500ms itu terjadi
**sebelum** request diproses — penalti khusus method POST di edge Cloudflare
OpenSea.

Kontrol dari VPS yang sama: `POST api.github.com/graphql` **11ms**. Jadi POST
dari VPS ini tidak lambat secara umum — khusus ke `gql.opensea.io`.

**Kesimpulan: 774ms tidak bisa dihilangkan dari sisi kita.** Itu perilaku
infrastruktur OpenSea, dan berlaku sama untuk semua bot yang memakai endpoint
itu.

---

## Yang BISA dilakukan: berhenti membayar 774ms berulang kali

Latensinya tetap, tapi **frekuensi menabraknya** bisa diperbaiki.

Pola lama:

```
kirim → tunggu 780ms → jeda 200ms → kirim → tunggu 780ms → ...
jarak nyata antar percobaan: 1015ms  (bukan 200ms seperti yang diniatkan)
```

`retryDelayMs: 200` itu menyesatkan — jaraknya 1015ms karena 780ms latensi ikut
dihitung. Kalau stage buka tepat setelah satu percobaan gagal, deteksinya telat
sampai 1 detik penuh.

Pola pipeline (v10):

```
kirim → (200ms) → kirim → (200ms) → kirim → ...
jawaban ditangani begitu datang, siapa pun yang duluan sukses menang
```

Terukur:

```
                    jarak kirim    telat deteksi rata-rata
cara lama             1015ms              508ms
pipeline               201ms              101ms
                                    → lebih cepat ~407ms
```

**407ms di detik yang paling menentukan**, tanpa menyentuh 774ms itu.

Yang dijaga: begitu ada yang sukses, pengiriman baru berhenti. Hard error per
address tetap dicatat. Request yang sudah melayang hasilnya dibuang.

Uji mock (latensi 780ms disimulasikan):

```
✓ menang saat stage buka 1200ms        selesai 1409ms
✓ jarak kirim ~200ms                   rata-rata 201ms · 7 tembakan
✓ berhenti menembak setelah menang     0 tembakan setelah sukses
✓ semua gagal → throw, tidak hang      1231ms
```

Bisa dimatikan dengan `HAMMER_PIPELINE=false` kalau perlu debug.

---

## Pasang

```bash
cd ~/kizuna
cp -r /path/ke/kizuna_final/. .
rm -f PASANG.md CHANGELOG.md

npm install
cd aco-worker && npm install && cd ..
```

Migration: **tidak ada yang baru**. `supabase/migration_aco_parallel.sql` hanya
perlu kalau belum pernah dijalankan.

```bash
NEXT_PUBLIC_SUPABASE_URL="https://dummy.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="dummy" \
AUTH_SESSION_SECRET="dummy-panjang-sekali" \
WALLET_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
WORKER_SHARED_SECRET="dummy" \
npx next build

git add -A
git status --short | grep -E "\.env$|node_modules" && echo "STOP" || echo "aman"
git commit -m "perf(aco): hammer pipeline + skala 200 user"
git push origin main

cd aco-worker && node worker.js --check && cd ..
pm2 restart kizuna-aco-worker
```

Log harus menampilkan:

```
Kizuna ACO Worker v10
job aktif : tanpa batas
fase mint : maks 200 bersamaan
```

Saat mint jalan, log hammer sekarang menampilkan jumlah request melayang:

```
[GQL] Starting swap() pipeline loop (jeda kirim 200ms)...
[GQL] Attempt 10/300 — mint not live yet (4 request melayang)...
[GQL] ✅ Got calldata on attempt 14 (pipeline)
```

---

## Yang perlu diubah kalau member benar-benar 200

`app/api/aco/jobs/route.js:7` — `MAX_ACTIVE_JOBS = 3`. Dengan 200 member itu
berarti sampai 600 job aktif. Worker sanggup menampung (job menunggu ~0.58 MB),
tapi kalau 600 masuk fase mint serentak, p50 akan melonjak seperti uji 800
request di atas.

Kalau itu terjadi: turunkan `MAX_ACTIVE_JOBS` ke 2, atau tambah worker kedua.

---

## Kalau perlu worker kedua

`aco_claim_job` sudah pakai `for update skip locked`, jadi beberapa worker
berbagi database aman — tidak ada job diambil dua kali. Tinggal `WORKER_ID`
berbeda, tanpa perubahan kode.

Yang **tidak** boleh: dua worker berbagi wallet yang sama. `walletLock.js` mutex
in-process, tidak melihat proses lain → nonce bisa tabrakan. Kalau perlu, kunci
nonce harus pindah ke Postgres advisory lock.

---

## Yang belum terverifikasi

- **Semua uji beban pakai query ringan tanpa cookie.** Request mint sungguhan
  lebih berat dan ber-cookie SIWE. Yang terbukti: 200 koneksi paralel dan
  100 req/s berkelanjutan bukan masalah. Yang belum: apakah request ber-cookie
  punya batas berbeda.
- **Pipeline belum diuji dengan mint sungguhan** — baru mock dengan latensi
  780ms disimulasikan. Yang perlu diperhatikan di mint pertama: apakah
  `[GQL] ✅ Got calldata on attempt N` muncul dengan N lebih kecil dari biasanya.
- **200 SIWE login bersamaan** — butuh 200 private key member.
- **Rate 120/s belum diuji berkelanjutan** — hasil ukur mentok di 100/s.
- **Dua worker berbagi database** — jaminan `skip locked`, belum diuji.
- **Fungsi Postgres belum pernah dieksekusi.**
- **Gambar NFT tampil sungguhan** — butuh API key member.
- **Penyebab pasti penalti POST 500ms** — terbukti ada dan konsisten, tapi
  alasannya di sisi OpenSea dan tidak bisa dilihat dari luar.
