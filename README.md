# Garapan HQ

Dashboard internal buat rangkum garapan komunitas (CRYPTO, NFT, RAFFLE
LIVE/PAST). Cuma bisa diakses kalau login pakai akun Discord yang jadi
anggota server kalian. Ada panel admin buat dev/collab manager nambah,
edit, dan hapus garapan.

**Stack:** Next.js 14 (App Router) · NextAuth (Discord OAuth) · Supabase
(Postgres) · deploy ke Vercel.

---

## 1. Bikin Discord OAuth App

1. Buka https://discord.com/developers/applications → **New Application**.
2. Masuk ke tab **OAuth2 → General**:
   - Catat **Client ID** dan **Client Secret**.
   - Di **Redirects**, tambahkan:
     - `http://localhost:3000/api/auth/callback/discord` (buat dev lokal)
     - `https://DOMAIN-VERCEL-KALIAN/api/auth/callback/discord` (buat production, tambahin belakangan setelah deploy)
3. Server ID komunitas: klik kanan nama server di Discord → **Copy Server ID**
   (aktifkan Developer Mode dulu di Discord: Settings → Advanced).
4. Role ID buat admin (dev/collab manager): klik kanan role tersebut →
   **Copy Role ID**. Bisa lebih dari satu role, pisahkan dengan koma.

> Catatan: OAuth ini pakai scope `guilds.members.read`, jadi **tidak perlu
> bot** buat cek keanggotaan/role — cukup izin dari akun user sendiri saat
> login.

## 2. Setup Supabase

1. Buat project baru di https://supabase.com.
2. Buka **SQL Editor**, jalankan isi file `supabase/schema.sql` di repo ini.
3. Di **Project Settings → API**, catat:
   - `Project URL` → jadi `NEXT_PUBLIC_SUPABASE_URL`
   - `service_role` key (bukan `anon`!) → jadi `SUPABASE_SERVICE_ROLE_KEY`

## 3. Isi environment variables

Copy `.env.example` jadi `.env.local`, lalu isi semua nilainya:

```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_GUILD_ID=
DISCORD_ADMIN_ROLE_IDS=
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=       # generate: openssl rand -base64 32
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## 4. Jalanin lokal

```bash
npm install
npm run dev
```

Buka http://localhost:3000 — bakal kelempar ke halaman login dulu.

## 5. Deploy ke Vercel

1. Push folder ini ke repo GitHub.
2. Import repo di https://vercel.com/new.
3. Masukin semua environment variables yang sama kayak `.env.local`,
   tapi `NEXTAUTH_URL` diisi domain Vercel kalian
   (contoh: `https://garapan-hq.vercel.app`).
4. Setelah deploy jadi, balik lagi ke Discord Developer Portal →
   tambahin redirect URL production ke OAuth2 Redirects
   (`https://DOMAIN/api/auth/callback/discord`).

## Cara pakai

- **Semua member server**: login → langsung liat dashboard, filter by
  tab CRYPTO / NFT / RAFFLE, dan sub-filter LIVE/PAST khusus Raffle.
- **Admin (role sesuai `DISCORD_ADMIN_ROLE_IDS`)**: ada tombol
  **+ Admin** di navbar → bisa tambah, edit, hapus garapan langsung
  dari web, tersimpan ke Supabase.
- **Bukan member server**: setelah login bakal ditolak dan dilempar ke
  halaman "Access Denied", gak bisa liat isi apapun.

## Struktur penting

```
lib/auth.js              -> konfigurasi NextAuth + Discord provider
lib/discord.js           -> cek keanggotaan & role lewat Discord API
middleware.js            -> gerbang: wajib login + member, /admin wajib admin
app/api/garapan/         -> API CRUD (GET publik-member, POST/PUT/DELETE admin-only)
components/Dashboard.js  -> tampilan grid + filter kategori
components/AdminPanel.js -> form CRUD admin
supabase/schema.sql      -> skema tabel `garapan`
```
