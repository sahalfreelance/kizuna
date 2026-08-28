# Deploy ACO (Auto Checkout) — panduan step-by-step

Urutan ini penting. Jangan lompat.

```
1. Migration Supabase        (manual di browser)
2. Bikin WALLET_ENCRYPTION_KEY  (sekali, dipakai di 2 tempat)
3. Set env di Vercel
4. Push kode                 (dari VPS)
5. Setup worker di VPS
6. Jalankan lewat pm2
7. Tes end-to-end
```

---

## Cara kerjanya (biar paham saat debugging)

```
Website (Vercel)              Supabase                 Worker (VPS, pm2)
────────────────              ──────────               ─────────────────
import wallet         ──►     aco_wallets
                              (terenkripsi)
bikin job mint        ──►     aco_jobs  (QUEUED)  ◄──  polling tiap 5 detik
                                                        │
lihat log realtime    ◄──     aco_logs            ◄────┤ login SIWE
                                                        │ tunggu window
riwayat + hasil       ◄──     aco_jobs (DONE)     ◄────┘ mint & kirim tx
```

Website **tidak** mengeksekusi mint — Vercel function maksimal 300 detik, tidak
cukup untuk menunggu mint window. Website hanya panel kontrol.

Konsekuensi praktisnya: **kalau worker mati, job tidak jalan** walaupun website
tetap bisa dibuka. Cek `pm2 list` kalau job nyangkut di QUEUED.

---

## STEP 1 — Migration Supabase

SQL Editor → New query → paste isi `supabase/migration_add_aco.sql` → **Run**.

Yang dibikin:
- `aco_wallets` — wallet member, private key terenkripsi
- `aco_jobs` — antrean job mint
- `aco_logs` — log per job (yang muncul di website)

Verifikasi:

```sql
select table_name from information_schema.tables
where table_name in ('aco_wallets','aco_jobs','aco_logs');
-- harus 3 baris
```

---

## STEP 2 — Bikin kunci enkripsi

Di VPS:

```bash
openssl rand -base64 32
```

**Simpan hasilnya.** Nilai yang sama dipakai di DUA tempat: Vercel dan
`aco-worker/.env`. Kalau beda, worker tidak bisa mendekripsi wallet yang
diimpor lewat website, dan semua job akan gagal dengan pesan
"WALLET_ENCRYPTION_KEY di worker kemungkinan BEDA".

⚠️ **Kalau kunci ini hilang, semua wallet tersimpan jadi sampah permanen.**
Tidak ada recovery — enkripsinya AES-256-GCM, tanpa kunci tidak bisa dibuka.
Simpan cadangan di password manager.

---

## STEP 3 — Env di Vercel

Settings → Environment Variables → tambah:

| Key | Value |
|---|---|
| `WALLET_ENCRYPTION_KEY` | hasil Step 2 |

Cuma satu. Yang lain sudah ada dari deploy sebelumnya.

---

## STEP 4 — Push kode

```bash
cd ~/kizuna
git add -A
git status --short | grep -E "\.env$|node_modules" && echo "STOP" || echo "aman"
git commit -m "feat(aco): auto checkout multi-user, worker di VPS"
git push origin main
```

Build lokal dulu kalau mau yakin (butuh env dummy — Next.js mengumpulkan data
halaman saat build):

```bash
npm install
NEXT_PUBLIC_SUPABASE_URL="https://dummy.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="dummy" \
AUTH_SESSION_SECRET="dummy-panjang" \
WALLET_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
npx next build
```

Harus muncul `✓ Compiled successfully` dengan route `/aco`, `/api/aco/drop`,
`/api/aco/jobs`, `/api/aco/wallets`.

Setelah Vercel Ready:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://kizunafnf.vercel.app/api/aco/wallets
# 401 = route hidup dan auth jalan
```

---

## STEP 5 — Setup worker di VPS

```bash
cd ~/kizuna/aco-worker
npm install
cp .env.example .env
nano .env
```

Isi `aco-worker/.env`:

```ini
# RPC Ethereum. https:// atau wss:// dua-duanya jalan.
RPC_URL=
CHAIN_ID=1

# Sama dengan yang di Vercel
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# WAJIB SAMA dengan yang di Vercel (hasil Step 2)
WALLET_ENCRYPTION_KEY=

# Dipakai login SIWE ke OpenSea
OPENSEA_API_KEY=

WORKER_ID=vps-utama
POLL_INTERVAL_MS=5000
```

Kunci permission-nya — file ini berisi service role key dan kunci enkripsi
wallet:

```bash
chmod 600 .env
```

**Uji konfigurasi sebelum jalan:**

```bash
node worker.js --check
```

Output yang benar:

```
  ✓ OPENSEA_API_KEY ada
  ✓ WALLET_ENCRYPTION_KEY valid
  ✓ Supabase tersambung
  ✓ RPC tersambung · chainId 1

  Semua pemeriksaan lolos. Worker siap dijalankan.
```

Kalau ada `✗`, pesannya menyebut env mana yang salah. Perbaiki dulu — jangan
lanjut ke pm2.

---

## STEP 6 — Jalankan lewat pm2

Dari root repo (bukan dari `aco-worker/`):

```bash
cd ~/kizuna
pm2 start ecosystem.config.js --only kizuna-aco-worker
pm2 logs kizuna-aco-worker --lines 20
```

Yang harus terlihat:

```
  ┌──────────────────────────────────────────────────────────┐
  │  Kizuna ACO Worker v1                                    │
  └──────────────────────────────────────────────────────────┘
  ✓ OPENSEA_API_KEY ada
  ✓ WALLET_ENCRYPTION_KEY valid
  ✓ Supabase tersambung
  ✓ RPC tersambung · chainId 1
  worker id : vps-utama
  polling   : tiap 5s
```

Simpan supaya hidup lagi setelah VPS reboot:

```bash
pm2 save
pm2 startup        # ikuti perintah yang dia cetak
```

`ecosystem.config.js` juga sudah memuat `garapan-bot`. Kalau bot lu sekarang
dijalankan manual dan mau dipindah ke config ini:

```bash
pm2 delete garapan-bot
pm2 start ecosystem.config.js
pm2 save
```

---

## STEP 7 — Tes end-to-end

### 7a. Import wallet

Buka `/aco` → panel **WALLETS** → `+ import`.

Baca peringatannya (memang sengaja ditaruh di atas form). **Pakai wallet
burner**, isi ETH secukupnya untuk gas + harga mint.

Verifikasi private key tidak pernah keluar ke browser:

```bash
curl -s https://kizunafnf.vercel.app/api/aco/wallets \
  -H "Cookie: kizuna_session=<token kamu>" | python3 -m json.tool
```

Response harus berisi `address` saja — **tidak ada** `encrypted_key` maupun
private key.

Cek di Supabase bahwa yang tersimpan memang terenkripsi:

```sql
select address, left(encrypted_key, 20) || '…' as key_preview
from aco_wallets;
-- key_preview harus mulai dengan "v1:" — bukan "0x"
```

### 7b. Bikin job

Panel **JOB BARU** → isi collection slug → **CEK** → pilih stage → pilih
wallet → **JADWALKAN MINT**.

Job muncul di **RIWAYAT JOB** dengan status `QUEUED`.

### 7c. Pastikan worker mengambilnya

Dalam ~5 detik, status harus berubah `QUEUED` → `CLAIMED`, dan log mulai
muncul di website. Cek juga dari VPS:

```bash
pm2 logs kizuna-aco-worker --lines 30
```

Kalau status **tetap QUEUED lebih dari 30 detik**, worker tidak jalan:

```bash
pm2 list                                    # status harus "online"
pm2 logs kizuna-aco-worker --err --lines 30  # lihat errornya
```

### 7d. Tes batal

Bikin job dengan stage yang masih lama, lalu klik **BATALKAN**. Status jadi
`CANCELLED` dan worker berhenti di titik pemeriksaan berikutnya (dia mengecek
status pembatalan saat menunggu, sebelum login, dan sebelum mint).

Job yang sudah `RUNNING` **tidak bisa** dibatalkan — transaksi mungkin sudah
masuk mempool, dan itu tidak bisa ditarik.

### 7e. Tes isolasi antar user

Login sebagai user lain, buka `/aco`. Wallet dan job user pertama **tidak
boleh** kelihatan. Semua query di API difilter `user_id`.

---

## Troubleshooting

| Gejala | Sebab | Solusi |
|---|---|---|
| Job nyangkut di `QUEUED` | worker mati | `pm2 restart kizuna-aco-worker` |
| "Gagal dekripsi wallet… kemungkinan BEDA" | `WALLET_ENCRYPTION_KEY` di worker ≠ Vercel | samakan, lalu import ulang wallet |
| `✗ Supabase: fetch failed` saat `--check` | URL/key salah, atau migration belum jalan | Step 1 & 5 |
| `✗ RPC gagal` | RPC_URL salah/limit habis | ganti RPC |
| Semua wallet gagal login OpenSea | `OPENSEA_API_KEY` salah/expired | ganti key |
| "Tidak dapat calldata — mungkin tidak eligible" | wallet tidak masuk allowlist stage itu | normal, bukan bug |
| Job `FAILED` "Stage sudah lewat" | job dibuat setelah mint tutup | bikin job baru |
| Job `FAILED` "nyangkut > 30 menit" | worker restart di tengah job | bikin job baru |

Query berguna:

```sql
-- job aktif sekarang
select id, slug, status, claimed_by, claimed_at, stage_start_time
from aco_jobs
where status in ('QUEUED','CLAIMED','RUNNING')
order by created_at;

-- log job tertentu
select level, message, wallet_address, created_at
from aco_logs where job_id = '<uuid>'
order by id;

-- hasil mint terakhir
select slug, status, result_summary, finished_at
from aco_jobs where status = 'DONE'
order by finished_at desc limit 5;

-- bebaskan job nyangkut manual
select aco_release_stuck_jobs();
```

---

## Batas yang dipasang

| Hal | Batas | Kenapa |
|---|---|---|
| Wallet per user | 20 | tiap wallet perlu login SIWE sendiri; makin banyak makin lama |
| Job aktif per user | 3 | worker jalan sequential, biar user lain kebagian |
| Mint amount | 1–100, dan ≤ max stage | validasi ganda di server |
| Gas limit | 21.000–5.000.000 | mencegah salah ketik yang bikin tx gagal |
| Job kedaluwarsa | 5 menit setelah stage mulai | `MAX_LATE_MS` |
| Job nyangkut | 30 menit | otomatis di-`FAILED` |

Semua divalidasi **di server**, bukan cuma di UI.

---

## Soal keamanan private key — sekali lagi

Yang sudah dilakukan secara teknis:

- Enkripsi **AES-256-GCM**, kunci di env, **bukan** di database
- Private key **tidak pernah** dikirim balik ke browser — tidak ada endpoint yang bisa
- Dekripsi **hanya** di worker VPS, di memori, saat mint
- Address hasil dekripsi **dicocokkan** dengan yang tersimpan; kalau tidak cocok wallet dilewati
- Private key **tidak pernah** masuk log (`aco_logs` hanya menyimpan address)
- Tabel `aco_wallets` kena RLS, hanya bisa diakses lewat service role key

Yang **tidak bisa** dihilangkan teknologi apa pun:

- Lu — pemegang `WALLET_ENCRYPTION_KEY` + akses Supabase — **secara teknis bisa
  menguras semua wallet member.** Mereka percaya pada lu, bukan pada sistemnya.
- VPS lu jadi target bernilai tinggi. Root jebol atau `.env` bocor = semua wallet habis.

Karena itu form import menyarankan wallet burner secara eksplisit. Pastikan
member benar-benar membacanya.
