# Kizuna — paket final

Semua hasil kerja dalam satu paket: **login username+password**, **ACO
multi-platform**, **worker VPS**. Struktur foldernya sudah sama dengan repo,
jadi tinggal di-copy.

Kalau lu sudah memasang patch sebelumnya, paket ini **menggantikan semuanya** —
aman ditimpa.

---

## Isi

```
supabase/     6 migration SQL
lib/          9 modul (auth, enkripsi, chains, platforms)
app/          14 route + 2 halaman
components/   3 komponen
bot/          6 file (command akun Discord)
aco-worker/   16 file (worker + pengaman)
```

63 file. Tidak ada `.env`, tidak ada `node_modules`.

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

# node_modules bot pernah ke-track
git rm -r -q --cached bot/node_modules 2>/dev/null || true

npm install
cd bot && npm install && cd ..
cd aco-worker && npm install && cd ..
```

Build dulu sebelum push:

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
git commit -m "feat: auth username+password + ACO multi-platform"
git push origin main
```

Kalau push ditolak: `git pull --rebase origin main` lalu push lagi.
**Jangan `--force`.**

---

## Migration — urut, jangan dilompat

SQL Editor Supabase, satu per satu:

| # | File | Isi |
|---|---|---|
| 1 | `migration_add_app_users.sql` | `app_users`, `app_login_events` |
| 2 | `migration_add_aco.sql` | `aco_wallets`, `aco_jobs`, `aco_logs` |
| 3 | `migration_aco_multichain.sql` | `aco_rpcs`, `opensea_api_keys` |
| 4 | `migration_aco_user_keys.sql` | `aco_user_keys` |
| 5 | `migration_aco_platforms.sql` | platform, preflight, `aco_attempts` |

Semuanya aman diulang. Yang ke-5 melepas lalu memasang ulang constraint
platform, jadi kalau lu sudah pernah menjalankan versi lamanya (yang belum ada
`mintbay`), jalankan lagi — tidak error.

`testing_app_users.sql` opsional, isinya user testing + query bantu.

Verifikasi:

```sql
select table_name from information_schema.tables
where table_name in ('app_users','app_login_events','aco_wallets','aco_jobs',
                     'aco_logs','aco_rpcs','opensea_api_keys','aco_user_keys',
                     'aco_attempts');
-- harus 9 baris

select conname, pg_get_constraintdef(oid) from pg_constraint
where conname = 'aco_jobs_platform_check';
-- harus memuat: opensea, mintbay, scatter, contract
```

---

## Environment

**Vercel:**

| Key | Cara bikin |
|---|---|
| `AUTH_SESSION_SECRET` | `openssl rand -base64 48` |
| `WALLET_ENCRYPTION_KEY` | `openssl rand -base64 32` |
| `WORKER_SHARED_SECRET` | `openssl rand -base64 32` |

`WALLET_ENCRYPTION_KEY` **hilang = semua wallet tersimpan jadi sampah.** Tidak
ada recovery. Simpan cadangannya di password manager.

**`bot/.env`** — tambah:
```ini
DISCORD_CLIENT_ID=
REGISTER_GUILD_ID=
AUTH_CHANNEL_ID=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

**`aco-worker/.env`** — dari `.env.example`:
```ini
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WALLET_ENCRYPTION_KEY=      # SAMA PERSIS dengan di Vercel
WEBSITE_URL=https://kizunafnf.vercel.app
WORKER_SHARED_SECRET=       # SAMA dengan di Vercel
```

`chmod 600` untuk kedua `.env`.

`RPC_URL` dan `CHAIN_ID` **tidak wajib** — tiap chain sudah punya RPC default.

---

## Jalankan

```bash
# slash command Discord — sekali saja
cd ~/kizuna/bot && node deploy-commands.js

# uji worker sebelum start
cd ~/kizuna/aco-worker
node check-rpc.js        # harus 13/13
node worker.js --check   # harus lolos semua

# start
cd ~/kizuna
pm2 start ecosystem.config.js
pm2 save
pm2 logs --lines 30
```

Log harus menunjukkan `garapan-bot [v23]` dan `Kizuna ACO Worker v2`.

---

## Fitur

**Login username+password.** Discord OAuth dibuang total. Password scrypt,
sesi token HMAC stateless. **1 user 1 device**, dijaga UNIQUE index Postgres.
Akun dibuat lewat bot: `/register` (popup form, password tidak muncul di
channel), `/change-password`, `/reset-device`, `/my-account`.

**ACO multi-platform.** Tab: **OpenSea** (aktif) · **Mintbay** `SOON` ·
**Scatter** `SOON` · **Mint by Contract** `SOON`. Wallet, API key, dan RPC
dipakai bersama semua platform — nanti tidak perlu import wallet ulang.

**13 chain**, dideteksi otomatis dari slug OpenSea — termasuk **Robinhood Chain**
(chainId 4663). Chain tidak bisa dipilih manual: kalau bisa, ada peluang salah
pasang dan tx dikirim ke jaringan yang salah.

**Maksimal 2 wallet per akun.** Saat bikin job, wallet dipilih bebas: satu, dua,
atau keduanya untuk mint bersamaan (paralel). Batas ditegakkan di server, bukan
cuma di UI.

**Custom RPC per chain** + fallback berlapis. RPC dienkripsi (URL Alchemy/Infura
mengandung API key). Worker memverifikasi chain id RPC sebelum mint.

**API key OpenSea per user**, diminta dari browser user (kuota 2/hari per IP,
jadi tidak berebut kuota IP server). Diperiksa tiap login, dirotasi di hari
ke-21 dari 30.

**Anti-revert** — simulasi `eth_call` + cek saldo sebelum kirim. Kalau
diperkirakan revert, tx tidak dikirim: gas tidak terbuang. Kalau RPC yang
bermasalah, simulasi dilewati dan tx tetap dikirim.

**Auto-retry** dengan klasifikasi error. Yang penting: `TX_SENT_UNKNOWN`
**tidak pernah diulang** — mengulang tx yang mungkin sudah masuk mempool bisa
jadi double mint.

**Anti rate-limit** — token bucket per host, `Retry-After` dihormati.

---

## Yang belum terverifikasi

Gw **tidak menyentuh database lu dan tidak mengirim transaksi apa pun.**

Belum teruji tanpa DB asli + wallet berisi ETH:
- alur penuh job `QUEUED` → tx terkirim
- pencatatan `aco_attempts` saat retry sungguhan
- penolakan wallet ke-3 oleh server (butuh 2 wallet tersimpan lebih dulu)
- mint di Robinhood Chain (RPC + chainId sudah terverifikasi, mint-nya belum)
- pembuatan API key OpenSea dengan respons sukses (kuota IP VPS ini habis)

Modul-modulnya sudah diuji terpisah terhadap mainnet asli — RPC failover,
anti-revert (revert reason `require(false)` berhasil didecode), rate limiter,
klasifikasi 12 jenis error, dan 13/13 RPC chain.

Tes pertama: satu wallet burner, stage gratis/murah, `max_attempts=2`.
