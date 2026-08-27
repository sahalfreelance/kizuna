# Patch: login username + password (1 user 1 device)

Discord OAuth dibuang total. Panduan deploy lengkap ada di `DEPLOY_AUTH.md`.

## Cara pasang

Extract zip ini, lalu dari dalam repo:

```bash
cd ~/kizuna

# 1. Copy semua file patch — struktur foldernya sudah sama dengan repo
cp -r /path/ke/kizuna_auth_patch/. .
rm -f PASANG.md          # file ini nggak perlu masuk repo

# 2. Hapus file Discord OAuth yang sudah tidak dipakai
git rm -r -q "app/api/auth/[...nextauth]" \
             app/api/auth/exchange \
             app/api/auth/refresh \
             app/api/auth/verify
git rm -q components/LoginButton.js \
          lib/auth.js \
          lib/discord.js \
          lib/discordOAuth.js \
          lib/mobileAuth.js

# 3. bot/node_modules sebelumnya ke-track di git (3055 file) — keluarkan.
#    File di disk tetap ada, cuma nggak ikut ke repo lagi.
git rm -r -q --cached bot/node_modules 2>/dev/null || true

# 4. Install dependency
npm install                 # next-auth dicabut dari package.json
cd bot && npm install       # + @supabase/supabase-js
cd ..

# 5. Build lokal dulu SEBELUM push
NEXT_PUBLIC_SUPABASE_URL="https://dummy.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="dummy" \
AUTH_SESSION_SECRET="dummy-secret-panjang-buat-build" \
npx next build
```

Harus muncul `✓ Compiled successfully` dengan route:
```
├ ƒ /api/auth/login
├ ƒ /api/auth/logout
├ ƒ /api/auth/me
├ ƒ /login
ƒ Middleware
```

Kalau build gagal, JANGAN push.

```bash
# 6. Cek nggak ada secret / node_modules mau ke-commit
git status --short | grep -E "\.env$|node_modules" && echo "STOP" || echo "aman"

# 7. Commit & push
git add -A
git commit -m "feat(auth): login username+password, akun via bot Discord, 1 user 1 device"
git push origin main
```

## Isi patch

**File baru**
```
supabase/migration_add_app_users.sql   ← JALANKAN DULU di Supabase
lib/localAuth.js                       scrypt hash + token HMAC
lib/sessionEdge.js                     verifikasi token via Web Crypto (Edge-safe)
lib/pageSession.js                     baca sesi di Server Component
app/api/auth/login/route.js
app/api/auth/logout/route.js
app/api/auth/me/route.js
components/LoginForm.js
bot/account-commands.js                /register /change-password /reset-device /my-account
bot/deploy-commands.js                 daftarin slash command ke Discord
bot/lib/localAuth.js                   salinan CommonJS — format hash HARUS sama
bot/lib/supabase.js
```

**File diubah**
```
lib/apiAuth.js            cookie + Bearer token lokal, Discord dibuang
middleware.js             verifikasi HMAC di Edge, tanpa query DB
app/login/page.js         form username+password
components/SignOutButton.js
app/{page,alpha,aco,inscription,admin}/page.js   getServerSession -> getPageSession
package.json              next-auth dicabut
bot/garapan-bot.js        +registerAccountCommands, versi v23
bot/package.json          +@supabase/supabase-js
.env.example / bot/.env.example
.gitignore
```

## Env baru yang WAJIB

**Vercel:**
```
AUTH_SESSION_SECRET=<openssl rand -base64 48>
```

**bot/.env:**
```
DISCORD_CLIENT_ID=
AUTH_CHANNEL_ID=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Detail + urutan lengkap: baca `DEPLOY_AUTH.md`.
