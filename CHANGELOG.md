# Riwayat perubahan

Urutan pembangunan, supaya jelas apa yang berubah kapan dan kenapa.

---

## 1. Login username + password

Discord OAuth dibuang total — 9 file dihapus, dependency `next-auth` dicabut.

- Password **scrypt** (bukan bcrypt: tidak menambah dependency native yang harus
  di-compile di Vercel)
- Sesi **token HMAC-SHA256 stateless**, membawa `device_id` + `session_version`
- **1 user 1 device**, dijaga UNIQUE partial index di Postgres — bukan cuma
  logika aplikasi
- Naikkan `session_version` → semua token lama mati seketika (logout paksa saat
  ganti password / reset device)
- Akun dibuat lewat 4 command bot Discord, semuanya balasan privat

**Masalah yang ketemu saat mengerjakan:**

`node:crypto` tidak tersedia di Edge runtime, dan `middleware.js` jalan di Edge.
`crypto.createHmac` akan gagal saat deploy Vercel — semua orang tidak bisa login,
dan baru ketahuan setelah deploy. Dibuat `lib/sessionEdge.js` yang memakai Web
Crypto (`crypto.subtle`), lalu diverifikasi token buatan Node bisa dibaca versi
Edge.

`bot/node_modules` ter-track di git (3.055 file) — dikeluarkan dengan
`git rm -r --cached`.

Timing attack di endpoint login: "user tidak ada" selesai instan, "password
salah" butuh ~60ms karena scrypt. Selisih itu bisa dipakai menebak username yang
terdaftar. Ditambah padding minimum 120ms, pesan error dibuat identik.

Race condition saat bind device: dua request bersamaan bisa sama-sama lolos cek
`device_id is null`. Dipakai `.is("device_id", null)` sebagai guard di UPDATE
plus re-check setelahnya.

**Keputusan yang berbeda dari permintaan awal:** diminta `/register username:x
password:y` sebagai argumen slash command. Tidak dilakukan — argumen slash
command tampil ke semua orang di channel, jadi password bocor. Ephemeral hanya
menyembunyikan balasan bot, bukan input user. Diganti popup form (modal):
command tetap dipakai di channel yang ditentukan, tapi isi form tidak pernah
masuk channel.

---

## 2. ACO — arsitektur

Script CLI dipecah: website = panel kontrol, worker VPS = eksekutor.

```
Website (Vercel)      Supabase           Worker (VPS, pm2)
────────────────      ────────           ─────────────────
kelola wallet    ──►  aco_wallets
bikin job        ──►  aco_jobs  ◄──────  polling 5s
log realtime     ◄──  aco_logs  ◄──────  login → tunggu → mint
```

**Kenapa tidak semua di Vercel:** function maksimal 300s (Hobby), cron Hobby
cuma 1×/hari dengan presisi ±59 menit — tidak mungkin mengejar mint yang buka
jam 14:30:00. `WebSocketProvider` juga butuh koneksi persisten.

`auth.js`, `graphql.js`, `mint.js` dari script CLI dipakai **apa adanya**.

Private key **AES-256-GCM**, kunci di env (bukan di DB), write-only — tidak ada
endpoint yang bisa mengembalikannya ke browser. Address hasil dekripsi
dicocokkan dengan yang tersimpan sebelum dipakai.

**Masalah yang ketemu:**

`auth.js` `throw` di top-level saat `OPENSEA_API_KEY` kosong. Di CLI tidak
masalah, tapi di worker itu mematikan proses dengan stack trace sebelum
pemeriksaan env lain jalan — tidak kelihatan env mana yang sebenarnya salah.
Pemeriksaan dipindah ke dalam fungsi.

`ethers` belum ada di `package.json` website — build gagal.

`WebSocketProvider` kebocoran socket: script CLI `process.exit(0)` di akhir jadi
tidak terasa, tapi worker hidup terus dan menumpuk socket tiap job sampai
kehabisan file descriptor. Ditambah `provider.destroy()` di `finally`.

---

## 3. Multi-chain + custom RPC

RPC default tiap chain diverifikasi langsung.

Chain **dideteksi otomatis** dari OpenSea, tidak dipilih user — menghilangkan
kelas kesalahan "tx dikirim ke jaringan salah".

RPC user dienkripsi (URL Alchemy/Infura mengandung API key di path). Setelah
disimpan hanya hostname yang ditampilkan.

**Masalah yang ketemu:**

SSRF — RPC URL diinput user lalu dihubungi dari server. Tanpa penjagaan bisa
dipakai memindai jaringan internal VPS termasuk metadata cloud. Ditolak:
`169.254.169.254`, `localhost`, `127.0.0.1`, `10.x`, `172.16.x`, `192.168.x`.

Chain id RPC tidak diverifikasi — RPC Ethereum dipakai untuk job Base berarti tx
ke jaringan salah, uang hilang tanpa mint. Sekarang `getNetwork().chainId`
diperiksa sebelum mint.

RPC default Ronin (`api.roninchain.com/rpc`) menolak tanpa API key (403).
Diganti `ronin.drpc.org` — terverifikasi chainId 2020.

---

## 4. API key OpenSea per user

Diminta: refresh key tiap user login. Endpoint diuji langsung:

```
POST https://api.opensea.io/api/v2/auth/keys
→ 429 {"errors":["Key creation rate limit exceeded. Maximum 2 keys per day."]}
```

**2 key per hari per IP.** Kalau server yang meminta, semua user berbagi kuota
IP server — habis setelah 2 user.

Solusinya: permintaan dijalankan dari **browser user**. Diverifikasi CORS-nya
mengizinkan:

```
OPTIONS /api/v2/auth/keys  Origin: https://kizunafnf.vercel.app
→ 200  access-control-allow-origin: https://kizunafnf.vercel.app
```

(Origin apa pun dipantulkan, jadi tidak ada whitelist domain yang perlu diurus.)

Key per user juga menghilangkan bentrok rate limit **pemakaian** saat beberapa
user mint bersamaan — ini poin yang benar dari usulan.

Umur key diperiksa tiap login, diganti di hari ke-21 dari 30 (sisa ~9 hari
sebagai bantalan). Kalau pembuatan gagal, key lama tetap dipakai selama belum
kedaluwarsa. Ada penjaga `sessionStorage` supaya satu sesi browser tidak
membuang kuota dengan mencoba berulang.

---

## 5. Anti-revert, auto-retry, anti rate-limit

**Anti-revert** — 4 pemeriksaan sebelum kirim, dari yang termurah: stage sudah
buka (0ms, tanpa jaringan) → saldo cukup → `eth_call` simulasi → `estimateGas`.

Yang dijaga supaya tidak salah: **kalau RPC yang bermasalah, simulasi dilewati
dan tx tetap dikirim.** Menyimpulkan "akan revert" dari RPC mati akan
membatalkan mint yang sehat.

**Auto-retry** — error diklasifikasi dulu. `RATE_LIMIT`/`RPC_DOWN` diulang +
pindah RPC. `NOT_ELIGIBLE`/`SOLD_OUT`/`INSUFFICIENT_FUNDS`/`WOULD_REVERT` stop.
`TX_SENT_UNKNOWN` **tidak pernah diulang** — mengulang tx yang mungkin sudah
masuk mempool bisa jadi double mint dan gas dobel.

Backoff pakai jitter: kalau 10 wallet kena rate limit bersamaan lalu semuanya
menunggu tepat 1000ms, mereka menabrak limit lagi bersamaan.

**Anti rate-limit** — token bucket per host. `gql.opensea.io` 8 req/s, RPC
15 req/s, terpisah. `Retry-After` dihormati (mengabaikannya berujung blokir lebih
lama). `node-fetch` dilepas, diganti `limitedFetch`.

**RPC failover** — satu chain boleh punya beberapa RPC. Gagal → pindah + ulangi
operasi yang sama. RPC gagal ditandai sakit 15 detik. Revert dan insufficient
funds **tidak** memicu failover — pindah RPC tidak mengubah hasilnya.
Pengiriman tx sengaja tanpa failover.

**Bug yang ketemu saat menguji sendiri:** `"wallet not eligible for this stage"`
salah diklasifikasi jadi `NOT_LIVE` karena mengandung kata "stage" dan "not" —
akan di-retry terus padahal wallet-nya memang tidak masuk allowlist. Urutan
pemeriksaan diperbaiki: `NOT_ELIGIBLE` sebelum `NOT_LIVE`.

---

## 6. Mintbay ditambahkan

Sebelumnya cuma Scatter — salah tangkap dari permintaan awal. Sekarang 4 tab:
OpenSea · Mintbay · Scatter · Mint by Contract.

Deskripsi "yang masih perlu dibangun" dipindah dari hardcode di komponen ke
field `pendingWork` di registry, jadi menambah platform berikutnya cuma perlu
mengubah `lib/platforms.js` + satu nilai di constraint SQL.

Constraint SQL diubah jadi drop-lalu-pasang-ulang supaya menambah platform tidak
perlu migration baru dari nol.

---

## 7. Robinhood Chain + batas 2 wallet

**Robinhood Chain.** Dikonfirmasi dulu dari sumbernya, bukan diasumsikan:

```
GET https://api.opensea.io/api/v2/chains
→ { "chain": "robinhood", "name": "Robinhood Chain", "symbol": "ETH",
    "supports_swaps": true,
    "block_explorer_url": "https://robinhoodchain.blockscout.com" }
```

`chainId` 4663 dari chainid.network (L2 di atas Ethereum via Arbitrum Orbit).
RPC diuji: `robinhood-rpc.publicnode.com` → chainId 4663, 103ms.

`identifier` harus **persis** `"robinhood"` seperti yang dipakai OpenSea — kalau
beda, deteksi chain dari slug akan menganggapnya tidak didukung. Diverifikasi
13/13 identifier registry cocok dengan daftar OpenSea.

RPC alternatif `rpc.arrowrpc.com` gagal (HTTP 530), tidak dipakai.

**Batas 2 wallet.** `MAX_WALLETS_PER_USER` diturunkan dari 20 → 2. Ditegakkan di
API (server), bukan cuma di UI — UI yang tombolnya disembunyikan masih bisa
diakali lewat curl.

Batas dikirim server ke UI lewat field `limit` di response `GET
/api/aco/wallets`, jadi kalau nanti diubah di API, UI ikut sendiri tanpa perlu
diedit.

Pemilihan wallet saat bikin job: bebas satu, dua, atau keduanya. Ditambah radio
indicator (◉/○), tombol "pakai semua" / "kosongkan", dan keterangan hidup —
"mint bersamaan (paralel)" saat dua-duanya dipilih, "mint 1 wallet" saat satu.

---

## Hasil tes

```
klasifikasi error         12/12 benar
  fatal → stop di percobaan 1 ✓
  TX_SENT_UNKNOWN → tidak diulang ✓
  maxAttempts=3 → tepat 3 ✓
  deadline → berhenti tepat waktu ✓

rate limiter
  burst 16 → 0ms ✓          8 berikutnya → 996ms (direm) ✓
  Retry-After: 2 → 2003ms ✓  99999 → dibatasi 60000ms ✓
  host terpisah ✓

RPC pool (mainnet asli)
  RPC mati → failover ✓      chain salah → ditolak ✓
  revert → tidak failover ✓  semua mati → tidak hang ✓

anti-revert (mainnet asli)
  stage belum buka → 0ms ✓
  saldo 0 vs 1 ETH → INSUFFICIENT_FUNDS ✓
  transfer 1jt WETH → WOULD_REVERT: "require(false)" ✓
  tx sehat → lolos, gas 26163 ✓
  RPC mati → degraded, bukan revert ✓

enkripsi wallet
  roundtrip ✓  salt acak ✓  tamper terdeteksi ✓  kunci beda ditolak ✓

auth
  12 skenario (redirect, device mismatch, token rusak, expired) ✓

chain
  check-rpc 13/13 chain OK ✓
  Robinhood chainId 4663 terkonfirmasi ✓
  13/13 identifier cocok dengan daftar OpenSea ✓
  registry website vs worker IDENTIK ✓

platform
  registry vs constraint SQL COCOK ✓
  scatter/mintbay/contract ditolak API ✓

endpoint tanpa auth       semua 401 ✓
build                     ✓ Compiled successfully
```
