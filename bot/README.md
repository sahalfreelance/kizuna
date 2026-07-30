# Garapan Auto-Sync Bot

Bot yang dengerin sampai 3 channel Discord sekaligus (RAFFLE, NFT, AIRDROP),
begitu ada pesan baru di salah satu channel itu, otomatis kekirim ke
website dan masuk ke kategori yang sesuai.

Ini **terpisah** dari web Next.js kalian — dijalanin sendiri di VPS,
nyambung ke web lewat 1 endpoint aman (`/api/webhook/garapan`).

---

## Bagian 1 — Update web kalian dulu (yang di GitHub/Vercel)

1. Copy folder `webhook-route-for-website/app/api/webhook/garapan/route.js`
   dari paket ini ke folder project web kalian, di path yang sama persis:
   ```
   app/api/webhook/garapan/route.js
   ```
   Kalau kalian sebelumnya udah sempet nambahin `app/api/webhook/raffle/route.js`
   dari paket sebelumnya, **hapus folder itu** — udah digantikan yang generik ini.

2. Tambahin 1 environment variable baru di **Vercel → Settings →
   Environment Variables** (skip kalau udah pernah bikin ini sebelumnya):
   ```
   RAFFLE_WEBHOOK_SECRET=<bikin string acak panjang, misal generate dari https://generate-secret.vercel.app/32>
   ```
   Simpen nilainya, dipakai lagi di Bagian 4. (Namanya tetap
   `RAFFLE_WEBHOOK_SECRET` walau sekarang dipakai buat semua kategori —
   biar gak perlu ganti-ganti env var lagi.)

3. Push perubahan ke GitHub (`git add . && git commit -m "generic webhook + airdrop category" && git push`),
   Vercel bakal auto-redeploy.

## Bagian 2 — Update database (Supabase)

Kategori `AIRDROP` belum dikenal sama tabel yang lama. Buka
**Supabase → SQL Editor → New query**, jalanin ini:

```sql
alter table garapan drop constraint if exists garapan_category_check;
alter table garapan add constraint garapan_category_check
  check (category in ('CRYPTO', 'NFT', 'RAFFLE', 'AIRDROP'));
```

Klik **Run**. Data lama gak kehapus, cuma nambahin kategori baru yang diizinin.

## Bagian 3 — Bikin/pakai Bot Discord

1. Buka https://discord.com/developers/applications
2. Pakai application yang sama kayak buat OAuth login kemarin (atau bikin baru, bebas).
3. Klik menu **Bot** di sidebar kiri. Kalau belum ada bot user, klik **Add Bot**.
4. Di **Privileged Gateway Intents**, nyalain **Message Content Intent** (WAJIB).
5. Klik **Reset Token** → copy (`DISCORD_BOT_TOKEN`). Cuma muncul sekali.
6. Klik **OAuth2 → URL Generator** → centang scope **`bot`** → di Bot
   Permissions centang **View Channels** dan **Read Message History** →
   copy URL yang muncul di bawah → buka di browser → pilih server kalian → Authorize.

## Bagian 4 — Ambil Channel ID

Aktifin Developer Mode dulu kalau belum (Discord Settings → Advanced →
Developer Mode). Terus buat **setiap channel yang mau dipantau**:
klik kanan channel-nya → **Copy Channel ID**.

Kalian gak wajib isi ketiga-tiganya — kosongin aja yang gak mau dipantau.

## Bagian 5 — Jalanin bot di VPS

1. Upload folder `bot/` ini ke VPS kalian (scp/WinSCP seperti sebelumnya).
2. SSH ke VPS:
   ```bash
   cd bot
   npm install
   cp .env.example .env
   nano .env
   ```
3. Isi `.env`:
   ```
   DISCORD_BOT_TOKEN=<dari Bagian 3>
   RAFFLE_CHANNEL_ID=<channel id raffle, kosongin kalau gak dipantau>
   NFT_CHANNEL_ID=<channel id nft, kosongin kalau gak dipantau>
   AIRDROP_CHANNEL_ID=<channel id airdrop, kosongin kalau gak dipantau>
   WEBSITE_URL=https://kizunafnf.vercel.app
   RAFFLE_WEBHOOK_SECRET=<sama persis kayak di Vercel, Bagian 1>
   ```
   Simpen (Ctrl+O, Enter, Ctrl+X).

4. Tes jalanin dulu:
   ```bash
   node garapan-bot.js
   ```
   Harusnya muncul:
   ```
   Bot aktif sebagai NamaBot#1234. Channel yang dipantau:
     - 111111111111111111 -> RAFFLE
     - 222222222222222222 -> NFT
     - 333333333333333333 -> AIRDROP
   ```
5. Coba post pesan di salah satu channel itu → cek terminal, harusnya
   muncul `[NFT] Terkirim ke website: "..."`. Buka web, cek tab kategori
   yang sesuai, entry baru harusnya langsung nongol.

## Bagian 6 — Biar bot jalan terus (24/7), pakai pm2

```bash
npm install -g pm2
pm2 start garapan-bot.js --name garapan-bot
pm2 save
pm2 startup
```
(command terakhir nampilin 1 baris command lagi, copy-paste & jalanin,
biar bot auto-nyala lagi kalau VPS reboot)

Cek status kapan aja:
```bash
pm2 status
pm2 logs garapan-bot
```

---

## Catatan penting

- Bot ini cuma proses pesan dari **member biasa** (skip pesan dari bot
  lain secara default). Kalau raffle/giveaway kalian diposting **oleh
  bot lain** (misal bot giveaway pihak ketiga), buka `garapan-bot.js`,
  cari baris:
  ```js
  if (message.author.bot) return;
  ```
  dan hapus/comment baris itu.
- Setiap pesan baru di channel RAFFLE otomatis jadi entry status **LIVE**.
  Buat nandain raffle udah selesai (PAST), sementara ini masih manual —
  buka `/admin` di web, edit entry-nya, ganti status ke PAST.
- NFT dan AIRDROP gak punya status LIVE/PAST (nyamain kayak kategori
  CRYPTO) — kalau nanti kalian mau airdrop juga ada status "masih bisa
  klaim" vs "udah berakhir", tinggal bilang aja, gampang ditambahin.
- Kalau pesannya berupa **embed** (dari bot pihak ketiga), bot otomatis
  ambil title/description/gambar dari embed-nya duluan.
