# Patch: ACO (Auto Checkout) multi-user

Panduan deploy lengkap: `DEPLOY_ACO.md`.

## Cara pasang

```bash
cd ~/kizuna

# 1. Copy semua file — struktur foldernya sudah sama dengan repo
cp -r /path/ke/kizuna_aco_patch/. .
rm -f PASANG.md          # file ini tidak perlu masuk repo

# 2. Install dependency
npm install              # + ethers (dipakai /api/aco/wallets buat turunkan address)
cd aco-worker && npm install && cd ..

# 3. Build lokal SEBELUM push
NEXT_PUBLIC_SUPABASE_URL="https://dummy.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="dummy" \
AUTH_SESSION_SECRET="dummy-panjang" \
WALLET_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
npx next build
```

Harus `✓ Compiled successfully` dengan route:
```
├ ƒ /aco
├ ƒ /api/aco/drop
├ ƒ /api/aco/jobs
├ ƒ /api/aco/jobs/[id]
├ ƒ /api/aco/wallets
├ ƒ /api/aco/wallets/[id]
```

```bash
# 4. Cek tidak ada secret / node_modules mau ke-commit
git add -A
git status --short | grep -E "\.env$|node_modules" && echo "STOP" || echo "aman"

# 5. Commit & push
git commit -m "feat(aco): auto checkout multi-user, worker di VPS"
git push origin main
```

## Isi patch

**Website**
```
supabase/migration_add_aco.sql      ← JALANKAN DULU di Supabase
lib/walletCrypto.js                 AES-256-GCM encrypt/decrypt
app/api/aco/wallets/route.js        GET daftar · POST import
app/api/aco/wallets/[id]/route.js   DELETE · PATCH
app/api/aco/jobs/route.js           GET daftar · POST bikin job
app/api/aco/jobs/[id]/route.js      GET detail+log · DELETE batal
app/api/aco/drop/route.js           proxy info drop OpenSea
app/aco/page.js                     ganti ComingSoon
components/AcoDashboard.js          UI: wallet + job + log realtime
package.json                        + ethers
.env.example                        + WALLET_ENCRYPTION_KEY
.gitignore                          + aco-worker/
```

**Worker VPS**
```
aco-worker/worker.js                loop: claim job → login → tunggu → mint
aco-worker/package.json
aco-worker/.env.example
aco-worker/lib/walletCrypto.js      salinan ESM — format HARUS sama
aco-worker/lib/supabase.js
aco-worker/lib/jobLogger.js         tulis ke aco_logs + stdout
aco-worker/lib/auth.js              ← dari script CLI kamu
aco-worker/lib/graphql.js           ← dari script CLI kamu
aco-worker/lib/mint.js              ← dari script CLI kamu
ecosystem.config.js                 pm2: garapan-bot + kizuna-aco-worker
```

`auth.js`, `graphql.js`, `mint.js` dipakai **apa adanya** dari script CLI kamu.
Satu perubahan kecil di `auth.js`: pemeriksaan `OPENSEA_API_KEY` dipindah dari
top-level ke dalam fungsi, supaya worker bisa melaporkan env yang kurang dengan
pesan jelas alih-alih stack trace.

## Env baru

**Vercel:**
```
WALLET_ENCRYPTION_KEY=<openssl rand -base64 32>
```

**aco-worker/.env:**
```
RPC_URL=
CHAIN_ID=1
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
WALLET_ENCRYPTION_KEY=      ← SAMA PERSIS dengan yang di Vercel
OPENSEA_API_KEY=
```

`WALLET_ENCRYPTION_KEY` harus identik di kedua tempat. Kalau beda, worker tidak
bisa mendekripsi wallet dan semua job gagal.

## Jalankan worker

```bash
cd ~/kizuna/aco-worker
node worker.js --check          # uji semua env dulu

cd ~/kizuna
pm2 start ecosystem.config.js --only kizuna-aco-worker
pm2 save
```
