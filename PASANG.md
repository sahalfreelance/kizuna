# Kizuna — paket final

Login username+password, ACO multi-platform, eligibility checker, worker VPS.
Struktur folder sudah sama dengan repo — tinggal `cp -r`.

Paket ini **menggantikan semua zip sebelumnya**. Aman ditimpa.

72 file. Tidak ada `.env`, tidak ada `node_modules`.

---

## ⚠ Yang berubah di update ini

**1. Status mint sekarang dibaca dari CHAIN, bukan dari OpenSea.** Job lu
dilaporkan `0/1 berhasil` padahal NFT-nya **benar-benar ter-mint**. Gw buktikan
dari tx lu sendiri (rincian di bawah).

**2. Detail + gambar NFT hasil mint** ditampilkan di panel job.

**3. Dialog konfirmasi** tidak lagi pakai `window.confirm()` bawaan browser.

**4. Retry sia-sia dihentikan** — percobaan 2 & 3 di log lu tidak akan terjadi lagi.

Worker naik ke **v5**. Wajib restart. **Tidak ada migration baru.**

---

## Pasang

```bash
cd ~/kizuna
cp -r /path/ke/kizuna_final/. .
rm -f PASANG.md CHANGELOG.md

npm install
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
git commit -m "feat(aco): konfirmasi on-chain + galeri item + dialog bertema"
git push origin main

pm2 restart kizuna-aco-worker
pm2 logs kizuna-aco-worker --lines 20
```

Log harus **`Kizuna ACO Worker v5`**.

---

## Perbaikan 1: status dibaca dari chain

Log lu:

```
OK    Tx dikirim: 0x4e43…1d5e
WARN  Percobaan 1 gagal (RATE_LIMIT): 429 Too Many Requests (gql.opensea.io)
WARN  Percobaan 2 gagal (UNKNOWN): Tx sudah terkirim
WARN  Percobaan 3 gagal (UNKNOWN): Tx sudah terkirim
OK    Selesai — 0/1 wallet berhasil mint · 1 tx perlu dicek manual
```

Gw baca tx lu langsung dari Robinhood Chain:

```
status     : 1 (SUKSES)
block      : 49464109
gasUsed    : 128836
token masuk: 2 (#600, #601 ERC721)
```

Mint-nya **berhasil**. Yang gagal cuma pembacaan status dari `gql.opensea.io`
karena kena rate limit — dan itu dilaporkan sebagai mint gagal.

Sekarang status ditentukan dari **receipt transaksi**: tidak bisa kena rate limit
OpenSea, tidak butuh cookie, hasilnya pasti. Token yang masuk dihitung dari event
`Transfer`/`TransferSingle`/`TransferBatch` dari address nol ke wallet lu.

OpenSea sekarang cuma dipakai untuk melengkapi nama & gambar, **setelah** status
sudah pasti. Kalau OpenSea kena 429, yang hilang cuma gambar — bukan status.

### Temuan sampingan

Contract address dari OpenSea (`0x5cae…328e`) **berbeda** dari kontrak yang
benar-benar me-mint NFT lu (`0x4997…5390`). Ini normal di SeaDrop: alamat yang
dipanggil dan kontrak NFT bisa beda.

Kalau log difilter ketat ke alamat OpenSea, hasilnya **0 token** padahal 2 token
masuk. Jadi filter dipakai sebagai preferensi: kalau tidak ada yang cocok, semua
mint ke wallet lu diterima.

---

## Perbaikan 2: retry sia-sia dihentikan

Percobaan 2 dan 3 di log lu langsung menabrak guard "tx sudah terkirim" —
menghasilkan dua WARN tidak berguna dan membuang ~1,7 detik.

Penyebabnya error `alreadySent` diklasifikasi `UNKNOWN` (retryable). Sekarang
langsung dikenali sebagai `TX_SENT_UNKNOWN` dan percobaan berhenti seketika.

---

## Perbaikan 3: galeri item hasil mint

Panel job sekarang menampilkan:

```
ITEM YANG DIDAPAT   2 item                              lihat tx ↗
┌──────────┐ ┌──────────┐
│ [gambar] │ │ [gambar] │
│  #600    │ │  #601    │
│ ERC721   │ │ ERC721   │
│ opensea↗ │ │ opensea↗ │
└──────────┘ └──────────┘
```

Baris hasil per wallet juga lebih informatif:

```
OK  0xBD0c…908D  0x4e43…1d5e  2 item  blk 49464109  gas 128.836
```

Gambar NFT sering di IPFS dan bisa lambat/gagal, jadi tiap kartu punya fallback:
token id tampil besar, link OpenSea tetap bisa diklik. Token yang baru di-mint
biasanya belum terindeks OpenSea — itu ditandai "belum terindeks", bukan error.

Daftar URL explorer yang tadinya hardcode di UI sekarang diambil dari
`lib/chains.js`, jadi menambah chain tidak perlu mengedit UI lagi.

---

## Perbaikan 4: dialog konfirmasi bertema

`window.confirm()` dirender browser/OS — tidak bisa diberi tema, dan
**memblokir thread JS** sehingga log realtime berhenti diperbarui selama dialog
terbuka.

Diganti `components/ConfirmDialog.js`: tema gelap, font monospace, bar judul
seperti panel terminal, dot warna (merah untuk aksi destruktif), animasi masuk
halus. Enter = lanjut, Esc = batal, klik luar = batal.

Pesannya juga diperjelas. Contoh hapus wallet:

> Private key-nya dihapus permanen dari database. Kalau lu belum simpan
> cadangannya di tempat lain, wallet ini tidak bisa dipulihkan dari sini.

Dan batalkan job saat `CLAIMED`:

> Worker sedang memproses job ini. Pembatalan berlaku sebelum tx dikirim; kalau
> tx sudah terkirim, ia tidak bisa ditarik kembali.

3 tempat diganti: hapus wallet, hapus RPC custom, batalkan job.

---

## Hasil tes

```
tx SUNGGUHAN milik user (Robinhood Chain, block 49464109)
  status 1 SUKSES, gasUsed 128836 ✓
  2 token terdeteksi: #600, #601 ERC721 ✓
  worker LAMA bilang 0/1 · chain bilang SUKSES 2 token ✓

extractMintedTokens        9 kasus
  ERC721 mint ✓  transfer biasa diabaikan ✓
  mint ke wallet lain diabaikan ✓
  ERC1155 Single qty 3 ✓  Batch 2 id total qty 7 ✓
  3 mint sekaligus ✓  log rusak tidak crash ✓
  kontrak cocok diutamakan, kalau tidak ada → fallback ✓

fetchMintedItems (token asli user)
  tanpa API key → fallback ✓
  2 input → 2 output, semua punya tokenId + openseaUrl ✓

explorerTxUrl              7 chain ✓ (chain tidak dikenal → null)
build                      ✓ Compiled successfully
window.confirm tersisa     0
```

---

## Yang belum terverifikasi

Gw **tidak menyentuh database lu dan tidak mengirim transaksi apa pun.**

- **Gambar NFT belum pernah tampil sungguhan.** `api.opensea.io/v2` menolak
  tanpa API key (401) dari sini, dan token lu belum terindeks. Jalur fallback
  sudah teruji (token id + link tetap ada); jalur gambar akan terbukti saat lu
  buka job dengan API key aktif di produksi.
- **Dialog konfirmasi belum gw lihat terender.** Gw tidak bisa melihat gambar,
  jadi yang gw pastikan: build lolos, `window.confirm` sudah 0, keyboard
  handler + cleanup terpasang. Tampilannya perlu lu nilai sendiri.
- Alur mint sukses end-to-end dengan kode baru (dulu jalur ini yang salah lapor).

Tes berikutnya: mint sekali lagi. Yang harus lu lihat — `Mint SUKSES · N item ·
block …`, tidak ada percobaan 2/3 yang sia-sia, dan galeri item di panel job.
Kalau job lu yang lama masih tersimpan, panel galerinya kosong karena datanya
belum ada saat itu.
