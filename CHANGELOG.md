# Riwayat perubahan

Urutan pembangunan, supaya jelas apa yang berubah kapan dan kenapa.

---

## 1. Login username + password

Discord OAuth dibuang total — 9 file dihapus, `next-auth` dicabut.

- Password **scrypt** (bukan bcrypt: tidak menambah dependency native yang harus
  di-compile di Vercel)
- Sesi **token HMAC-SHA256 stateless**, membawa `device_id` + `session_version`
- **1 user 1 device**, dijaga UNIQUE partial index Postgres
- Naikkan `session_version` → semua token lama mati seketika

**Masalah yang ketemu:** `node:crypto` tidak ada di Edge runtime, dan
`middleware.js` jalan di Edge — akan gagal saat deploy dan semua orang tidak bisa
login. Dibuat `lib/sessionEdge.js` pakai Web Crypto. Timing attack di login
("user tidak ada" instan vs "password salah" ~60ms) ditutup dengan padding
120ms. Race condition bind device ditutup dengan guard `.is("device_id", null)`.

**Keputusan berbeda dari permintaan:** diminta `/register username:x password:y`
sebagai argumen slash command — tidak dilakukan, argumen slash command tampil ke
semua orang di channel. Diganti popup form.

---

## 2. ACO — arsitektur

Website = panel kontrol, worker VPS = eksekutor. Vercel function maks 300s dan
cron Hobby 1×/hari ±59 menit, jadi tidak mungkin mengejar mint jam 14:30:00.

`auth.js`, `graphql.js`, `mint.js` dari script CLI dipakai apa adanya.
Private key AES-256-GCM, kunci di env, write-only.

**Masalah yang ketemu:** `auth.js` `throw` di top-level saat API key kosong.
`ethers` belum ada di `package.json`. `WebSocketProvider` kebocoran socket (CLI
`process.exit()` jadi tidak terasa, worker hidup terus jadi menumpuk).

---

## 3. Multi-chain + custom RPC

Chain dideteksi otomatis dari OpenSea, tidak dipilih user.

**Masalah yang ketemu:** SSRF — RPC URL diinput user lalu dihubungi server, bisa
dipakai memindai jaringan internal VPS. Chain id RPC tidak diverifikasi — RPC
Ethereum untuk job Base berarti tx ke jaringan salah. RPC Ronin default 403,
diganti `ronin.drpc.org`.

---

## 4. API key OpenSea per user

Diminta refresh tiap login. Endpoint diuji: `429 Maximum 2 keys per day` — per
IP. Kalau server yang minta, kuota habis setelah 2 user.

Solusi: diminta dari **browser user**. CORS diverifikasi mengizinkan. Umur dicek
tiap login, diganti di hari ke-21 dari 30.

---

## 5. Anti-revert, auto-retry, anti rate-limit

**Anti-revert** — stage buka (0ms) → saldo → `eth_call` → `estimateGas`. Kalau
RPC bermasalah, simulasi dilewati dan tx tetap dikirim.

**Auto-retry** — `RATE_LIMIT`/`RPC_DOWN` diulang + pindah RPC. `NOT_ELIGIBLE`/
`SOLD_OUT`/`INSUFFICIENT_FUNDS`/`WOULD_REVERT` stop. `TX_SENT_UNKNOWN` tidak
pernah diulang (risiko double mint).

**Anti rate-limit** — token bucket per host, `Retry-After` dihormati.

**Bug yang ketemu:** `"wallet not eligible for this stage"` salah diklasifikasi
`NOT_LIVE` karena mengandung "stage" dan "not". Urutan diperbaiki.

---

## 6. Mintbay ditambahkan

Sebelumnya cuma Scatter — salah tangkap. Sekarang 4 tab. Deskripsi "yang masih
perlu dibangun" dipindah ke field `pendingWork` di registry.

---

## 7. Robinhood Chain + batas 2 wallet

Dikonfirmasi dari `GET api.opensea.io/api/v2/chains`:
`{ "chain": "robinhood", "supports_swaps": true }`. chainId 4663 dari
chainid.network, RPC diuji 103ms.

`MAX_WALLETS_PER_USER` 20 → 2, ditegakkan di server.

---

## 8. Eligibility checker + fix login SIWE

### Bug login yang bikin job gagal

```
ERROR  Login gagal: No access_token in response cookies — auth failed
```

**Bug yang gw masukkan sendiri di bagian 5**, saat `node-fetch` diganti fetch
bawaan Node:

```js
if (typeof res.headers.raw === "function") {   // node-fetch → ADA
  rawCookies = res.headers.raw()["set-cookie"];
} else {
  rawCookies = [res.headers.get("set-cookie")]; // ← undici jatuh ke sini
}
```

`headers.get("set-cookie")` **menggabungkan semua header Set-Cookie jadi satu
string**. Parser di bawahnya cuma mengambil pasangan pertama (`__cf_bm`),
sehingga `access_token` tidak pernah terbaca. OpenSea sebenarnya membalas 200 —
login sukses, pembacaannya rusak.

Diperbaiki pakai `getSetCookie()` (standar WHATWG). Fallback ke `headers.raw()`
dan split manual `/,\s*(?=[^=;,\s]+=)/` — tidak bisa asal `split(",")` karena
`Expires` mengandung koma.

### Checker

Diadaptasi dari `pdonir/nft-mint-check-pipeline`.

**Temuan yang menentukan arsitekturnya:**

```
tanpa auth  → UNAUTHORIZED @ stages.isEligible
              UNAUTHORIZED @ stages.eligibleMaxTotalMintableByWallet
dengan SIWE → field terbuka
```

Checker tidak bisa jalan dari browser — butuh SIWE login pakai private key, yang
hanya didekripsi di worker VPS.

**Perbedaan dari repo aslinya:** query dipasang di `collectionBySlug` alih-alih
`dropBySlug` — sudah terbukti jalan di worker ini dan sekaligus memberi contract
address + chain.

**Label.** Dipilih `ELIGIBLE 2/2` + rincian per wallet, bukan `ELIGIBLE FCFS`.
Alasan: nama stage sudah tertulis di baris yang sama, dan nama stage di OpenSea
bebas ("OG", "Guaranteed", "Phase 2") — tidak selalu FCFS/WL.

**`unknown` dibedakan dari `not eligible`.** `decideEligible()` mengembalikan
`null` kalau data tidak terbaca. Menampilkan "NOT ELIGIBLE" padahal cuma error
jaringan akan membuat user membatalkan mint yang sebenarnya bisa. Wallet yang
gagal dicek juga tidak dihitung di agregasi.

---

## 9. Job jalan selama stage masih buka + checker dipercepat

### Logika window diperbaiki

Gejalanya:

```
ERROR  Stage sudah lewat 21 menit — job kedaluwarsa
```

Job digagalkan kalau waktu **buka** sudah lewat > `MAX_LATE_MS` (5 menit).
Itu salah: selama stage masih **OPEN**, mint masih bisa dieksekusi dan masih ada
gunanya. Yang seharusnya menentukan adalah waktu **TUTUP**.

Sekarang:

| Kondisi | Perilaku |
|---|---|
| Stage sudah tutup | gagal |
| Stage masih buka, bukanya lewat | **jalan**, `skipWait = true` (langsung mint) |
| Stage belum buka | tunggu window |
| Tidak ada `endTime` | jalan, anti-revert yang menyaring |

`MAX_LATE_MS` dihapus dari CONFIG dan `.env.example`.

`endTimeISO` juga di-refresh dari OpenSea bersama `startTimeISO` — inilah yang
menentukan boleh jalan atau tidak, jadi tidak boleh pakai data lama.

Kasus tanpa `endTime` sengaja **tidak** digagalkan: OpenSea tidak selalu memberi
waktu tutup, dan menolak duluan berarti kehilangan mint yang sebenarnya bisa.
Kalau ternyata sudah tutup, preflight/simulasi yang menolaknya — dan itu tidak
membakar gas.

Diuji 6 kasus (`_test_window.mjs`, dihapus setelah lolos): 6/6 sesuai harapan,
termasuk kasus 21 menit persis seperti yang dialami user.

### Checker dipercepat

Keluhan: checker lama, padahal ACO tujuannya cepat.

| Penyebab | Dulu | Sekarang |
|---|---|---|
| Login 2 wallet | sequential ~4s | **paralel** ~2s |
| Query eligibility | sequential ~1s | **paralel** ~0.5s |
| Worker polling antrean | 5.000ms | **700ms** (`ELIG_POLL_MS`) |
| Browser polling hasil | 1.000ms | **400ms**, 250ms pertama |
| Login per pengecekan | selalu | **cache 20 menit** |

Login dibuat paralel dengan catatan: yang membuat opensea.io kena 429 adalah
BANYAK wallet (5+). Dua wallet aman, dan rateLimiter tetap memberi jeda otomatis
kalau ternyata kena.

Worker polling diturunkan ke 700ms **tanpa merugikan job mint** — jadwal mint
menit-menitan, dan `claimNextJob()` tetap dipanggil tiap tick.

`durationMs` disimpan di hasil dan ditampilkan di panel, supaya kecepatannya
bisa diverifikasi user, bukan cuma diklaim.

### Session dipakai bersama checker ↔ mint

Ini yang paling berpengaruh untuk kecepatan mint. Dulu `loginWallets()` selalu
SIWE login dari nol (~2s per wallet) di detik-detik yang menentukan.

Sekarang `loginWallets()` memakai `getSiweSession()` — cookie dari eligibility
check dipakai ulang. Plus **pemanasan 90 detik sebelum window buka**
(`PREHEAT_BEFORE_MS`): kalau cookie sudah kedaluwarsa, login terjadi saat itu,
bukan di detik nol.

`waitForWindow()` diberi callback `onPreheat` untuk ini. Kegagalan pemanasan
tidak menggagalkan job — hanya peringatan, karena `mintGuarded` masih punya
retry sendiri.

Untuk cache session, `encryptPrivateKey()` ditambahkan ke `walletCrypto.js`
versi worker (sebelumnya worker cuma perlu dekripsi). Cookie berisi access_token
JWT — setara sesi login penuh, jadi tidak boleh plaintext. Diverifikasi
kompatibel lintas modul website ↔ worker.

---

## Hasil tes

```
logika window             6/6 benar
  buka 21m lalu, masih buka   → LAMA gagal, BARU JALAN ✓
  buka 3 jam lalu, masih buka → LAMA gagal, BARU JALAN ✓
  sudah TUTUP 10m lalu        → GAGAL (memang harus) ✓
  tanpa endTime               → JALAN + peringatan ✓
  belum buka                  → tunggu window ✓

SIWE login (setelah fix)  berhasil, access_token JWT valid ✓
decideEligible            9/9 benar
  WL tanpa data → UNKNOWN (bukan false) ✓
summarizeStages           FCFS 1/2, Public 2/2 ✓
  wallet gagal tidak dihitung not-eligible ✓
enkripsi                  roundtrip ✓ IV acak ✓ tamper ditolak ✓
  website ↔ worker kompatibel ✓
klasifikasi error         12/12 benar
rate limiter              burst, Retry-After, host terpisah ✓
RPC pool (mainnet asli)   failover ✓ chain salah ditolak ✓
anti-revert (mainnet)     revert reason "require(false)" didecode ✓
chain                     13/13 RPC ✓ 13/13 identifier cocok OpenSea ✓
endpoint tanpa auth       7/7 → 401 ✓
build                     ✓ Compiled successfully
```

### Yang tidak bisa diuji

**Nilai `isEligible` sungguhan.** Semua koleksi yang dicoba (`based-fellas`,
`opepen-edition`, `pudgypenguins`, `azuki`, `milady`, +11 lain) `drop`-nya
`null` — mint sudah selesai. `/launchpad` diblokir 403 dari VPS.

**Angka kecepatan checker end-to-end.** Perbaikannya nyata dan bisa dibaca di
kode (paralel, cache, interval polling), tapi ~1-2 detik itu perkiraan dari
komponennya, bukan pengukuran dengan DB produksi. `durationMs` di panel akan
menunjukkan angka sebenarnya.
