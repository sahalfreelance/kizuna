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

Perbaikan: `processJob` tidak di-`await` — dijalankan di latar dan dilacak di
`Map`, dengan batas `MAX_CONCURRENT_JOBS` (default 8). Loop mengambil job
sebanyak slot tersisa, bukan satu per tick.

Aman paralel karena beban job saat menunggu hampir nol; yang padat cuma
detik-detik mint, dan itu dijaga rate limiter per-host.

**Urutan pengambilan juga salah.** Dulu `created_at` — job yang dibuat lebih dulu
menang walau jadwalnya jauh. Sekarang `stage_start_time`.

Klaim dipindah ke fungsi Postgres `aco_claim_job` dengan `for update skip
locked`: satu pernyataan, tidak bisa bertabrakan, pemanggil paralel melewati
baris yang sedang dikunci. Ada fallback ke cara lama kalau migration belum
dijalankan (dengan peringatan sekali).

### Masalah B: job dibunuh saat menunggu

```js
// CLAIMED/RUNNING lebih tua dari 30 menit → FAILED "job nyangkut"
```

Job yang sah sedang menunggu window 6 jam ke depan ikut dibunuh. Artinya
menjadwalkan mint > 30 menit di depan **tidak pernah bisa berhasil**, terlepas
dari masalah antrean.

Perbaikan: kolom `heartbeat_at` + `startHeartbeat()` yang memperbarui tiap 30
detik selama job diproses. `aco_release_dead_jobs` hanya membunuh job tanpa kabar
3 menit.

Kalau migration belum ada, pembersihan **dilewati sepenuhnya** — bukan jatuh ke
cara lama, karena cara lama justru merusak. Timer di-`unref()` supaya tidak
menahan proses keluar saat SIGTERM, dan dihentikan di blok `finally`.

### Masalah C: dua job, satu wallet

Sejak paralel, dua job bisa memakai wallet sama (user menjadwalkan 2 slug,
windownya bertabrakan). Keduanya membaca nonce "pending" yang sama, tx kedua
**menimpa** tx pertama — satu mint hilang, gas terbakar.

`lib/walletLock.js`: mutex in-process per address, membungkus ambil-nonce →
kirim-tx. Wallet berbeda tidak saling menunggu.

**Bug yang ketemu saat menguji:** kunci bocor — 52 entri tersisa setelah 50
operasi. Penyebabnya `locks.get(key) === prev.then(() => current)` di blok
`finally`; `.then()` membuat promise BARU tiap dipanggil, jadi perbandingannya
selalu false dan entri tidak pernah dihapus. Referensinya sekarang disimpan di
variabel.

### Probe `--check` yang hampir merusak

Versi pertama memeriksa kesiapan paralel dengan **memanggil `aco_claim_job`** —
fungsi itu benar-benar mengklaim job. Artinya `node worker.js --check` bisa
mencuri job milik worker yang sedang jalan dan membiarkannya `CLAIMED` oleh
`__probe__`. Diganti: memeriksa keberadaan kolom `heartbeat_at`.

---

## Hasil tes kumulatif

```
simulasi loop paralel vs sequential
  sequential 2/3 job KELEWAT · paralel 0/3 ✓
  paralel 1.5x lebih cepat ✓

kunci per wallet          5 kasus ✓
  wallet sama berurutan, tanpa overlap ✓
  wallet beda paralel (120ms vs 240ms) ✓
  error tidak deadlock ✓  return value ✓
  50 operasi → 0 entri (tidak bocor) ✓

tx SUNGGUHAN user (Robinhood, block 49464109)
  status 1 SUKSES, gasUsed 128836, 2 token ✓
extractMintedTokens       9 kasus ✓
fetchMintedItems          selalu balikan entri lengkap ✓
explorerTxUrl             7 chain ✓
logika window             6/6 ✓
SIWE login                access_token JWT valid ✓
decideEligible            9/9 ✓
summarizeStages           1/2 & 2/2 ✓
enkripsi                  roundtrip ✓ tamper ditolak ✓ web↔worker ✓
klasifikasi error         12/12 ✓
rate limiter              burst, Retry-After, host terpisah ✓
RPC pool (mainnet)        failover ✓ chain salah ditolak ✓
anti-revert (mainnet)     revert reason didecode ✓
chain                     13/13 RPC ✓ 13/13 identifier ✓
endpoint tanpa auth       7/7 → 401 ✓
window.confirm tersisa    0 ✓
build                     ✓ Compiled successfully
```

### Yang tidak bisa diuji dari sini

- **Fungsi Postgres belum pernah dieksekusi.** `aco_claim_job` dan
  `aco_release_dead_jobs` ditulis hati-hati tapi belum dijalankan Postgres.
- **Paralel dengan DB sungguhan** dan **heartbeat di kondisi nyata** (job
  menunggu berjam-jam lalu tetap hidup).
- **Gambar NFT tampil sungguhan** — `api.opensea.io/v2` menolak tanpa API key
  dari VPS ini.
- **Tampilan dialog konfirmasi** — build lolos, `window.confirm` 0, tapi hasil
  rendernya belum dilihat.
- **Nilai `isEligible` sungguhan** — semua koleksi yang dicoba `drop`-nya `null`.
