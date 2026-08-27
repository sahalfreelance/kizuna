# Login username + password — panduan deploy

Discord OAuth dibuang total. Login sekarang username + password, akun dibuat
lewat bot Discord, dan **1 akun = 1 device**.

```
1. Migration Supabase        (manual di browser)
2. Set env baru di Vercel    (AUTH_SESSION_SECRET)
3. Push kode                 (dari VPS)
4. Set env bot + install     (di VPS)
5. Daftarin slash command    (sekali)
6. Restart bot               (di VPS)
7. Tes end-to-end
```

---

## STEP 1 — Migration Supabase

SQL Editor > New query > paste isi `supabase/migration_add_app_users.sql` > Run.

Yang dibikin:
- Tabel `app_users` — username, password_hash, discord_id, device_id, session_version
- UNIQUE index `app_users_device_id_key` — satu device tidak bisa dipakai dua akun
- Tabel `app_login_events` — audit login (termasuk percobaan gagal)

Verifikasi:

```sql
select table_name from information_schema.tables
where table_name in ('app_users','app_login_events');
-- harus 2 baris

select indexname from pg_indexes where tablename = 'app_users';
-- harus ada app_users_device_id_key dan app_users_username_key
```

---

## STEP 2 — Env baru di Vercel

Bikin secret dulu di VPS:

```bash
openssl rand -base64 48
```

Vercel > project > Settings > Environment Variables > tambah:

| Key | Value |
|---|---|
| `AUTH_SESSION_SECRET` | hasil `openssl rand -base64 48` di atas |

Ini kunci tanda tangan token sesi (HMAC-SHA256). **Kalau nilainya diganti,
semua user langsung ter-logout** — itu memang perilaku yang diinginkan sebagai
tombol darurat.

Env Discord OAuth sudah tidak dipakai dan boleh dihapus:
`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_GUILD_ID`,
`DISCORD_ADMIN_ROLE_IDS`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`.

> Hapusnya **setelah** deploy sukses. Kalau `AUTH_SESSION_SECRET` lupa di-set,
> kode masih mau memakai `NEXTAUTH_SECRET` sebagai cadangan — jadi jangan
> hapus keduanya sekaligus sebelum yang baru terbukti jalan.

---

## STEP 3 — Push kode

```bash
cd ~/kizuna
git add -A
git status --short          # pastikan TIDAK ada .env dan bot/node_modules
git commit -m "feat(auth): login username+password, akun via bot Discord, 1 user 1 device"
git push origin main
```

Kalau muncul `node_modules` di `git status`, jangan commit — `.gitignore`
sudah mengaturnya, jalankan `git rm -r --cached bot/node_modules` dulu.

Tunggu Vercel **Ready**, lalu cek:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://kizunafnf.vercel.app/api/auth/me
# 401 = route hidup dan auth jalan

curl -s -X POST https://kizunafnf.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"x","password":"y"}'
# {"error":"device_id tidak valid...","code":"BAD_DEVICE_ID"} = validasi jalan
```

---

## STEP 4 — Env bot + install dependency

Bot sekarang butuh akses Supabase (bikin/ubah akun) dan Application ID.

```bash
cd ~/kizuna/bot
npm install                 # @supabase/supabase-js sudah masuk package.json
nano .env
```

Tambahkan ke `bot/.env` yang sudah ada:

```ini
# Application ID bot: Discord Developer Portal > General Information
DISCORD_CLIENT_ID=

# Channel tempat /register dkk boleh dipakai (klik kanan channel > Copy ID).
# Kalau dikosongkan, command bisa dipakai di channel mana saja.
AUTH_CHANNEL_ID=

# Sama dengan yang di Vercel. Bot butuh SERVICE ROLE karena app_users kena RLS.
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Isi kalau mau command langsung muncul di 1 server saja (buat testing).
# Kosongkan untuk daftar global (~1 jam menyebar).
REGISTER_GUILD_ID=
```

> `SUPABASE_SERVICE_ROLE_KEY` itu kunci penuh ke database. Pastikan
> `bot/.env` tidak pernah ke-commit (sudah ada di `.gitignore`) dan
> `chmod 600 bot/.env`.

---

## STEP 5 — Daftarin slash command

Jalankan **sekali** (dan tiap kali daftar command berubah):

```bash
cd ~/kizuna/bot
node deploy-commands.js
```

Output yang diharapkan:

```
Command terdaftar di guild 123...:
  /register
  /change-password
  /reset-device
  /my-account
```

Kalau `REGISTER_GUILD_ID` dikosongkan, command didaftarkan global dan bisa
butuh sampai 1 jam untuk muncul.

---

## STEP 6 — Restart bot

```bash
pm2 restart garapan-bot
pm2 logs garapan-bot --lines 20
```

Yang harus terlihat di log:

```
Command akun aktif (channel 123...): /register /change-password /reset-device /my-account
Bot aktif sebagai NamaBot#1234 [v23]. Channel yang dipantau:
```

`[v23]` menandakan kode baru yang jalan. Kalau masih `[v22]`, bot belum
me-reload — cek `pm2 list` dan path-nya.

Kalau muncul `SUPABASE_SERVICE_ROLE_KEY belum di-set`, berarti `bot/.env`
belum lengkap — command akun akan menolak dengan pesan jelas, bot forwarder
garapan tetap jalan normal.

---

## STEP 7 — Tes end-to-end

### 7a. Bikin akun

Di Discord, channel yang di-set `AUTH_CHANNEL_ID`, ketik `/register`.
Popup form muncul — isi username, password, ulangi password.

Yang dicek:
- Balasan bot **hanya kamu yang lihat** (ephemeral)
- Username & password **tidak muncul di channel**
- Coba `/register` lagi → ditolak, "Kamu sudah punya akun"
- Coba di channel lain → ditolak, "Salah channel"

### 7b. Login pertama (device terikat)

Buka https://kizunafnf.vercel.app/login, masuk pakai username & password itu.

Harus lolos ke dashboard. Cek di Discord `/my-account` — kolom **Perangkat**
sekarang terisi (misal `Chrome · Windows`).

### 7c. Tes 1 user 1 device — ini inti permintaannya

Login pakai akun yang sama dari **browser lain** (atau mode incognito, atau
HP lain). Harus **ditolak** dengan pesan:

> Akun ini sudah terikat ke perangkat lain. Jalankan /reset-device di bot
> Discord untuk pindah perangkat.

Verifikasi di Supabase:

```sql
select username, device_label, result, created_at
from app_login_events
order by created_at desc limit 5;
-- percobaan dari device kedua harus tercatat DEVICE_MISMATCH
```

### 7d. Tes pindah device

Di Discord: `/reset-device`. Lalu login lagi dari browser kedua → **harus
lolos**. Balik ke browser pertama, refresh → **harus ter-logout** (karena
`session_version` naik).

### 7e. Tes ganti password

Di Discord: `/change-password`. Isi password sekarang + password baru.

Setelah itu semua sesi mati — refresh dashboard harus balik ke `/login`.
Login dengan password lama harus gagal, password baru harus lolos.

### 7f. Tes 1 device 1 user

Dari browser yang sudah terikat ke akun A, coba login pakai akun B (yang
belum pernah login). Harus ditolak:

> Perangkat ini sudah dipakai akun lain. Satu perangkat hanya untuk satu akun.

---

## Menjadikan diri sendiri admin

Tidak ada command untuk ini (disengaja — biar tidak bisa disalahgunakan).
Lewat Supabase SQL Editor:

```sql
update app_users set is_admin = true, session_version = session_version + 1
where username = 'usernamekamu';
```

`session_version` dinaikkan supaya token lama (yang isinya `adm=0`) mati dan
user login ulang dengan token yang membawa hak admin.

---

## Kalau ada masalah

| Gejala | Sebab | Solusi |
|---|---|---|
| Login selalu 503 | `app_users` belum ada | Jalankan Step 1 |
| Login sukses tapi langsung balik ke /login | `AUTH_SESSION_SECRET` beda antar deployment/environment | Set nilai yang sama di Production & Preview |
| Semua user ter-logout mendadak | `AUTH_SESSION_SECRET` diganti | Kembalikan nilainya, atau biarkan semua login ulang |
| `/register` tidak muncul di Discord | command belum didaftarkan | Step 5. Kalau global, tunggu sampai 1 jam |
| Bot: "SUPABASE_SERVICE_ROLE_KEY belum di-set" | `bot/.env` kurang | Step 4 |
| User ganti browser jadi tidak bisa login | device_id web disimpan di localStorage | Ini memang perilakunya — `/reset-device` |
| `DEVICE_TAKEN` padahal HP baru | device_id masih terikat akun lain | Akun lama jalankan `/reset-device` |
| Admin panel tidak bisa dibuka | `is_admin` masih false | Lihat bagian admin di atas |

Query yang berguna:

```sql
-- daftar akun + status device
select display_username, discord_username, device_label,
       is_admin, is_active, last_login_at
from app_users order by created_at desc;

-- percobaan login gagal 24 jam terakhir
select username, result, device_id, ip, created_at
from app_login_events
where result <> 'OK' and created_at > now() - interval '24 hours'
order by created_at desc;

-- nonaktifkan akun (langsung ter-logout)
update app_users set is_active = false,
       session_version = session_version + 1
where username = 'target';
```

---

## Untuk app Android

Endpoint yang dipakai:

**Login** — `POST /api/auth/login`
```json
{ "username": "budi", "password": "...", "device_id": "<ANDROID_ID>", "device_label": "Samsung A54" }
```
Balikan sukses: `{ user, token, expires_in }`. Simpan `token` di
EncryptedSharedPreferences.

**Request berikutnya** — kirim header:
```
Authorization: Bearer <token>
```

**Cek sesi** — `GET /api/auth/me`

Kode status yang harus ditangani berbeda-beda:

| Status | Arti | Tindakan di app |
|---|---|---|
| `200` | sesi sehat | lanjut |
| `401` | sesi mati | hapus token, ke halaman login |
| `403` + `code: DEVICE_MISMATCH` | dipakai dari device lain | tampilkan "jalankan /reset-device di Discord" |
| `403` + `code: DEVICE_TAKEN` | device dipakai akun lain | tampilkan pesannya |
| `503` + `retryable: true` | gangguan sementara | **JANGAN hapus token**, coba lagi nanti |

Poin terakhir itu penting: memperlakukan 503 sebagai "sesi habis" adalah
penyebab bug "sesi berakhir terus" yang lama.

Untuk `device_id`, pakai nilai yang stabil per instalasi — `Settings.Secure.ANDROID_ID`,
atau UUID yang digenerate sekali lalu disimpan di EncryptedSharedPreferences.
Jangan pakai nilai yang berubah tiap update app, nanti user kena
`DEVICE_MISMATCH` tanpa sebab.
