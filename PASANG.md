# Kizuna — paket final

Login username+password, ACO multi-platform, eligibility checker, worker VPS.
Struktur foldernya sudah sama dengan repo — tinggal `cp -r`.

Paket ini **menggantikan semua zip sebelumnya**. Aman ditimpa.

---

## ⚠ Yang berubah di update ini

**1. Job tidak lagi gagal cuma karena waktu buka sudah lewat.** Logikanya
dulu salah. Sekarang yang menentukan adalah waktu **TUTUP** stage — selama
stage masih buka, mint tetap dieksekusi, dan langsung tanpa menunggu.

**2. Checker jauh lebih cepat.** ~7 detik → ~1-2 detik (rincian di bawah).

**3. Session SIWE dipakai bersama** antara checker dan mint, plus pemanasan
90 detik sebelum window buka.

Worker naik ke **v4**. Wajib restart.

---

## Isi

```
supabase/     7 migration SQL
lib/          9 modul (auth, enkripsi, chains, platforms)
app/          15 route + 2 halaman
components/   3 komponen
bot/          6 file (command akun Discord)
aco-worker/   19 file (worker + pengaman + checker)
```

68 file. Tidak ada `.env`, tidak ada `node_modules`.

---

## Pasang

```bash
cd ~/kizuna
cp -r /path/ke/kizuna_final/. .
rm -f PASANG.md CHANGELOG.md

# hapus file Discord OAuth (kalau belum)
git rm -r -q "app/api/auth/[...nextauth]" app/api/auth/exchange \
             app/api/auth/refresh app/api/auth/verify 2>/dev/null || true
git rm -q components/LoginButton.js lib/auth.js lib/discord.js \
          lib/discordOAuth.js lib/mobileAuth.js 2>/dev/null || true
git rm -r -q --cached bot/node_modules 2>/dev/null || true

npm install
cd bot && npm install && cd ..
cd aco-worker && npm install && cd ..
```

Build dulu:

```bash
NEXT_PUBLIC_SUPABASE_URL="https://dummy.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="dummy" \
AUTH_SESSION_SECRET="dummy-panjang-sekali" \
WALLET_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
WORKER_SHARED_SECRET="dummy" \
npx next build
```

Harus `✓ Compiled successfully`.

```bash
git add -A
git status --short | grep -E "\.env$|node_modules" && echo "STOP" || echo "aman"
git commit -m "fix(aco): mint jalan selama stage masih buka + checker lebih cepat"
git push origin main
```

Push ditolak → `git pull --rebase origin main` lalu push. **Jangan `--force`.**

---

## Migration

| # | File | Status |
|---|---|---|
| 1 | `migration_add_app_users.sql` | sudah |
| 2 | `migration_add_aco.sql` | sudah |
| 3 | `migration_aco_multichain.sql` | sudah |
| 4 | `migration_aco_user_keys.sql` | sudah |
| 5 | `migration_aco_platforms.sql` | sudah |
| 6 | `migration_aco_eligibility.sql` | **jalankan kalau belum** |

**Tidak ada migration baru di update ini.** Semuanya aman diulang.

---

## Jalankan

```bash
cd ~/kizuna/aco-worker
node worker.js --check    # harus "✓ Eligibility checker siap"

cd ~/kizuna
pm2 restart kizuna-aco-worker
pm2 logs kizuna-aco-worker --lines 20
```

Log harus **`Kizuna ACO Worker v4`**. Kalau masih v3, kode belum kepakai.

---

## Perbaikan 1: job tetap jalan selama stage masih buka

Yang lu alami:

```
ERROR  Stage sudah lewat 21 menit — job kedaluwarsa
```

Padahal stage-nya masih buka. Logikanya memang salah: dulu job digagalkan
kalau waktu **buka** sudah lewat lebih dari 5 menit (`MAX_LATE_MS`). Yang
seharusnya menentukan adalah waktu **tutup**.

Sekarang:

| Kondisi | Perilaku |
|---|---|
| Stage sudah **tutup** | gagal (memang tidak ada gunanya) |
| Stage **masih buka**, bukanya sudah lewat | **JALAN**, langsung tanpa menunggu |
| Stage belum buka | tunggu window, panaskan session 90s sebelum |
| Tidak ada `endTime` dari OpenSea | jalan, anti-revert yang menyaring |

`MAX_LATE_MS` dihapus. Kalau masih ada di `.env` lu, diabaikan.

Waktu tutup juga di-refresh dari OpenSea saat job diproses, bukan cuma pakai
data lama — karena inilah yang menentukan boleh jalan atau tidak.

Diuji 6 kasus, termasuk kasus lu persis:

```
KASUS LU: buka 21 menit lalu, stage buka 6 jam
  LAMA: GAGAL — lewat 21 menit — kedaluwarsa
  BARU: JALAN (skipWait) — lewat 21m tapi MASIH BUKA (tutup 360m lagi)

sudah TUTUP 10 menit lalu
  BARU: GAGAL — stage TUTUP 10 menit lalu     ← ini memang harus gagal

6/6 sesuai harapan
```

---

## Perbaikan 2: checker lebih cepat

Yang bikin lambat sebelumnya, dan perbaikannya:

| Penyebab | Dulu | Sekarang |
|---|---|---|
| Login 2 wallet berurutan | ~4s | **paralel** ~2s |
| Query eligibility berurutan | ~1s | **paralel** ~0.5s |
| Worker polling antrean | 5.000ms | **700ms** |
| Browser polling hasil | 1.000ms | **400ms** (250ms pertama) |
| Login ulang tiap cek | selalu | **cache 20 menit** |

Total kira-kira **7 detik → 1-2 detik**. Cek kedua untuk slug lain lebih cepat
lagi karena session sudah hangat: **~0.5 detik**.

Durasi asli ditampilkan di panel (`2 wallet dicek · 1.3s`) supaya lu bisa lihat
sendiri, bukan cuma percaya klaim gw.

---

## Perbaikan 3: session dipakai bersama checker ↔ mint

Ini yang paling berpengaruh untuk kecepatan mint.

Dulu mint selalu SIWE login dari nol (~2s per wallet) — di detik-detik yang
menentukan. Sekarang:

- Checker login → cookie masuk cache (terenkripsi, 20 menit)
- Mint pakai cookie yang sama, tidak login lagi
- **Pemanasan 90 detik sebelum window buka**: kalau cookie sudah kedaluwarsa,
  login terjadi saat itu, bukan di detik nol

Jadi kalau lu cek eligibility beberapa menit sebelum mint (yang wajar), saat
window buka worker tidak perlu login sama sekali.

---

## Eligibility checker — cara kerjanya

Ketik slug → **CEK**. Info drop langsung tampil, pengecekan jalan bersamaan:

```
ELIGIBILITY  2 wallet dicek · 1.3s              cek ulang

● LIVE  FCFS    allowlist  [ELIGIBLE 1/2]     max 2
        ✓ wallet-1 (max 2)   ✗ wallet-2

SOON    Public  public     [ELIGIBLE 2/2]     max 1
        ✓ wallet-1 (max 1)   ✓ wallet-2
```

`ELIGIBLE 2/2` = dua wallet lolos. `ELIGIBLE 1/2` = satu. Satu wallet saja →
cuma `ELIGIBLE`.

**`? TIDAK DIKETAHUI`** kalau data tidak terbaca — dibedakan dari
`NOT ELIGIBLE` dengan sengaja. Menampilkan "tidak eligible" padahal cuma error
jaringan akan membuat lu membatalkan mint yang sebenarnya bisa.

Checker jalan di worker karena field eligibility dikunci di balik auth
(terverifikasi: tanpa auth → `UNAUTHORIZED @ stages.isEligible`), dan SIWE login
butuh private key yang hanya didekripsi di VPS.

Kalau checker gagal, **job tetap bisa dibuat**. Checker itu bantuan, bukan syarat.

---

## Fitur lain

**Login username+password.** scrypt, token HMAC stateless, 1 user 1 device.
Akun lewat bot Discord: `/register`, `/change-password`, `/reset-device`,
`/my-account`.

**ACO multi-platform.** OpenSea (aktif) · Mintbay `SOON` · Scatter `SOON` ·
Mint by Contract `SOON`.

**13 chain** termasuk Robinhood (4663), dideteksi otomatis dari slug.

**Maks 2 wallet**, bisa pilih satu / dua / keduanya (paralel).

**Custom RPC per chain** + fallback, dienkripsi, chain id diverifikasi.

**API key OpenSea per user** dari browser user (kuota 2/hari per IP).

**Anti-revert** — simulasi sebelum kirim. RPC bermasalah → simulasi dilewati,
tx tetap dikirim.

**Auto-retry** dengan klasifikasi error. `TX_SENT_UNKNOWN` tidak pernah diulang.

**Anti rate-limit** — token bucket per host, `Retry-After` dihormati.

---

## Yang belum terverifikasi

Gw **tidak menyentuh database lu dan tidak mengirim transaksi apa pun.**

Belum teruji:
- Angka kecepatan checker di produksi. Perbaikannya nyata (paralel, cache,
  polling), tapi ~1-2 detik itu perkiraan dari komponennya — bukan pengukuran
  end-to-end dengan DB lu.
- Nilai `isEligible` sungguhan. Semua koleksi yang gw coba `drop`-nya `null`
  (mint sudah selesai); `/launchpad` diblokir 403 dari VPS. Yang terbukti:
  field terbuka setelah SIWE, struktur query benar.
- Mint sampai tx terkirim, dan `aco_attempts` saat retry sungguhan.

Yang **sudah** diuji: SIWE login berhasil (JWT valid), 6/6 kasus logika window,
9/9 kasus `decideEligible`, agregasi 2 wallet, enkripsi lintas modul, 13/13 RPC.

Tes berikutnya: bikin job untuk stage yang **sedang buka sekarang** — dulu itu
gagal instan, sekarang harus langsung mint.
