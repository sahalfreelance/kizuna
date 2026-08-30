# Riwayat perubahan

Ringkas per tahap: apa yang berubah, dan kenapa.

---

## 1. Login username + password

Discord OAuth dibuang total (9 file, `next-auth` dicabut). Password **scrypt**,
sesi **token HMAC stateless**, **1 user 1 device** via UNIQUE partial index
Postgres. Naikkan `session_version` = semua token lama mati seketika.

**Masalah yang ketemu:** `node:crypto` tidak ada di Edge runtime dan
`middleware.js` jalan di Edge — akan gagal setelah deploy dan semua orang tidak
bisa login. Dibuat `lib/sessionEdge.js` pakai Web Crypto. Timing attack di login
ditutup dengan padding 120ms. Race condition bind device ditutup dengan guard
`.is("device_id", null)`.

**Beda dari permintaan:** diminta `/register` pakai argumen slash command — tidak
dilakukan, argumen itu tampil ke seisi channel. Diganti popup form.

---

## 2. ACO — arsitektur

Website = panel kontrol, worker VPS = eksekutor. Vercel function maks 300s dan
cron Hobby 1×/hari ±59 menit — tidak mungkin mengejar mint jam 14:30:00.

`auth.js`, `graphql.js`, `mint.js` dari script CLI dipakai apa adanya. Private
key AES-256-GCM, kunci di env, write-only.

**Masalah yang ketemu:** `auth.js` `throw` di top-level; `ethers` belum ada di
`package.json`; `WebSocketProvider` kebocoran socket (CLI `process.exit()` jadi
tidak terasa, worker hidup terus jadi menumpuk).

---

## 3. Multi-chain + custom RPC

Chain dideteksi otomatis dari OpenSea, tidak dipilih user.

**Masalah yang ketemu:** SSRF — RPC URL diinput user lalu dihubungi server, bisa
dipakai memindai jaringan internal VPS. Chain id RPC tidak diverifikasi — RPC
Ethereum untuk job Base = tx ke jaringan salah. RPC Ronin default 403, diganti
`ronin.drpc.org`.

---

## 4. API key OpenSea per user

Endpoint diuji: `429 Maximum 2 keys per day` — **per IP**. Kalau server yang
minta, kuota habis setelah 2 user. Solusi: diminta dari **browser user** (CORS
diverifikasi mengizinkan). Umur dicek tiap login, diganti di hari ke-21 dari 30.

---

## 5. Anti-revert, auto-retry, anti rate-limit

**Anti-revert** — stage buka (0ms) → saldo → `eth_call` → `estimateGas`. Kalau
RPC bermasalah, simulasi dilewati dan tx tetap dikirim.

**Auto-retry** — `RATE_LIMIT`/`RPC_DOWN` diulang + pindah RPC.
`NOT_ELIGIBLE`/`SOLD_OUT`/`INSUFFICIENT_FUNDS`/`WOULD_REVERT` stop.
`TX_SENT_UNKNOWN` tidak pernah diulang.

**Anti rate-limit** — token bucket per host, `Retry-After` dihormati.

**Bug yang ketemu:** `"wallet not eligible for this stage"` salah diklasifikasi
`NOT_LIVE` karena mengandung "stage" dan "not". Urutan diperbaiki.

---

## 6. Mintbay ditambahkan

Sebelumnya cuma Scatter — salah tangkap. Jadi 4 tab. Deskripsi "yang masih perlu
dibangun" dipindah ke field `pendingWork` di registry.

---

## 7. Robinhood Chain + batas 2 wallet

Dikonfirmasi dari `GET api.opensea.io/api/v2/chains`. chainId 4663, RPC diuji
103ms. `MAX_WALLETS_PER_USER` 20 → 2, ditegakkan di server.

---

## 8. Eligibility checker + fix login SIWE

**Bug login.** `headers.raw()` cuma ada di node-fetch; setelah diganti undici,
kode jatuh ke `headers.get("set-cookie")` yang menggabungkan semua Set-Cookie
jadi satu string — parser cuma ambil pasangan pertama (`__cf_bm`), jadi
`access_token` tidak pernah terbaca. Diperbaiki pakai `getSetCookie()`.

**Checker.** Diadaptasi dari `pdonir/nft-mint-check-pipeline`. Field eligibility
dikunci di balik auth (tanpa auth → `UNAUTHORIZED @ stages.isEligible`), jadi
harus SIWE login — hanya bisa di worker. Label `ELIGIBLE 2/2` + rincian per
wallet. `unknown` dibedakan dari `not eligible`.

---

## 9. Job jalan selama stage masih buka + checker dipercepat

**Logika window.** Job digagalkan kalau waktu **buka** lewat > 5 menit — salah,
karena selama stage masih OPEN mint masih bisa. Yang menentukan sekarang waktu
**TUTUP**. `MAX_LATE_MS` dihapus. Diuji 6 kasus, 6/6 benar.

**Checker dipercepat** ~7s → ~1-2s: login paralel, query paralel, worker polling
5000→700ms, browser polling 1000→400ms, cache session 20 menit.

**Session dipakai bersama** checker ↔ mint, plus pemanasan 90 detik sebelum
window buka.

---

## 10. Konfirmasi on-chain + galeri item + dialog bertema

### Status mint dibaca dari chain

Log user:

```
OK    Tx dikirim: 0x4e43…1d5e
WARN  Percobaan 1 gagal (RATE_LIMIT): 429 (gql.opensea.io)
OK    Selesai — 0/1 wallet berhasil mint
```

Dibaca langsung dari Robinhood Chain: **status 1 SUKSES, block 49464109, 2 token
masuk (#600, #601)**. Mint berhasil; yang gagal cuma pembacaan status dari
OpenSea karena rate limit.

`waitForMintStatus()` (OpenSea) diganti `confirmOnChain()` (receipt). Receipt
tidak bisa kena rate limit OpenSea, tidak butuh cookie, hasilnya pasti. Token
dihitung dari event `Transfer`/`TransferSingle`/`TransferBatch` dari address nol
ke wallet — itu definisi mint, jadi transfer biasa tidak salah dihitung.

OpenSea sekarang cuma untuk melengkapi nama & gambar, **setelah** status pasti.
Kegagalannya tidak lagi bisa mengubah status.

### Contract address OpenSea bisa berbeda

Temuan dari tx sungguhan: OpenSea memberi `0x5cae…328e`, tapi NFT di-mint dari
`0x4997…5390`. Normal di SeaDrop — alamat yang dipanggil dan kontrak NFT bisa
beda.

Filter ketat menghasilkan **0 token** padahal 2 token masuk. Jadi filter dipakai
sebagai preferensi: cocok diutamakan, kalau tidak ada yang cocok semua mint ke
wallet ini diterima.

### Retry sia-sia

Percobaan 2 & 3 langsung menabrak guard `sentTxHash` — 2 WARN tidak berguna,
~1,7 detik terbuang. Penyebabnya `alreadySent` diklasifikasi `UNKNOWN`
(retryable). Sekarang dikenali langsung sebagai `TX_SENT_UNKNOWN` di `withRetry`
dan berhenti seketika.

### Galeri item

`components/MintedItems.js` — grid kartu NFT dengan gambar, token id, standard,
link OpenSea, badge quantity untuk ERC-1155.

Gambar NFT sering di IPFS dan bisa lambat/gagal, jadi tiap kartu punya fallback:
token id tampil besar, link tetap bisa diklik. Token baru mint biasanya belum
terindeks OpenSea — ditandai "belum terindeks", bukan error.

`lib/itemDetail.js` mencoba `api.opensea.io/v2` dulu, lalu `gql.opensea.io`, lalu
fallback minimal. **Selalu** mengembalikan entri selengkap input — token yang
gagal diambil tetap punya token id dan link.

Baris hasil per wallet ditambah `N item`, `blk`, `gas`. Daftar URL explorer yang
tadinya hardcode di UI diganti `explorerTxUrl()` dari `lib/chains.js`.

### Dialog konfirmasi

`window.confirm()` dirender browser/OS — tidak bisa diberi tema, dan
**memblokir thread JS** sehingga log realtime berhenti diperbarui selama dialog
terbuka.

`components/ConfirmDialog.js` + hook `useConfirm()`: tema gelap, bar judul gaya
panel terminal, dot warna (merah untuk destruktif), animasi masuk. Enter =
lanjut, Esc = batal, klik luar = batal, `body.overflow` dikembalikan saat unmount.

Pesan diperjelas — hapus wallet menyebut private key hilang permanen; batalkan
job saat `CLAIMED` menyebut tx yang sudah terkirim tidak bisa ditarik.

3 tempat diganti: hapus wallet, hapus RPC custom, batalkan job.

---

## Hasil tes kumulatif

```
tx SUNGGUHAN user (Robinhood, block 49464109)
  status 1 SUKSES, gasUsed 128836, 2 token ✓
  worker LAMA 0/1 vs chain SUKSES ✓

extractMintedTokens       9 kasus ✓
  ERC721/1155 Single/Batch ✓  transfer biasa diabaikan ✓
  wallet lain diabaikan ✓  log rusak tidak crash ✓
  kontrak cocok diutamakan, fallback kalau tidak ada ✓
fetchMintedItems          selalu balikan entri lengkap ✓
explorerTxUrl             7 chain ✓
logika window             6/6 ✓
SIWE login                access_token JWT valid ✓
decideEligible            9/9 ✓
summarizeStages           1/2 & 2/2 ✓  wallet gagal tidak dihitung ✓
enkripsi                  roundtrip ✓ tamper ditolak ✓ web↔worker ✓
klasifikasi error         12/12 ✓
rate limiter              burst, Retry-After, host terpisah ✓
RPC pool (mainnet)        failover ✓ chain salah ditolak ✓
anti-revert (mainnet)     revert reason "require(false)" didecode ✓
chain                     13/13 RPC ✓ 13/13 identifier ✓
endpoint tanpa auth       7/7 → 401 ✓
window.confirm tersisa    0 ✓
build                     ✓ Compiled successfully
```

### Yang tidak bisa diuji dari sini

- **Gambar NFT tampil sungguhan.** `api.opensea.io/v2` menolak tanpa API key
  (401) dari VPS ini, dan token user belum terindeks. Jalur fallback teruji;
  jalur gambar akan terbukti di produksi.
- **Tampilan dialog konfirmasi.** Build lolos dan `window.confirm` sudah 0, tapi
  hasil rendernya belum dilihat.
- **Nilai `isEligible` sungguhan** — semua koleksi yang dicoba `drop`-nya `null`.
- Alur mint sukses end-to-end dengan kode baru.
