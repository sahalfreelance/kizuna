#!/usr/bin/env node
// Bikin SQL buat nambah/ubah user secara manual — dipakai untuk TESTING atau
// bikin akun admin pertama.
//
// Kenapa harus lewat script, tidak bisa SQL murni?
// Password disimpan sebagai hash scrypt. Postgres/pgcrypto tidak punya scrypt
// (cuma bcrypt lewat crypt()), jadi hash-nya HARUS dibuat di Node dengan
// format yang sama persis seperti yang dipakai aplikasi. Script ini
// menghasilkan SQL yang tinggal di-paste ke Supabase SQL Editor.
//
// Pakai:
//   node make-user.js <username> <password>
//   node make-user.js <username> <password> --admin
//   node make-user.js <username> <password> --discord-id 123456789012345678
//
// Contoh:
//   node make-user.js tester rahasia123 --admin
//
// Lalu copy SQL yang keluar, paste ke Supabase SQL Editor, Run.

const { validateUsername, validatePassword, hashPassword } = require("./lib/localAuth");

const args = process.argv.slice(2);

function flagValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

const positional = args.filter((a, i) => {
  if (a.startsWith("--")) return false;
  // buang nilai yang menempel pada flag bernilai
  const prev = args[i - 1];
  if (prev === "--discord-id") return false;
  return true;
});

const [rawUsername, rawPassword] = positional;
const isAdmin = args.includes("--admin");

if (!rawUsername || !rawPassword) {
  console.error(`
Pakai: node make-user.js <username> <password> [--admin] [--discord-id <id>]

Contoh:
  node make-user.js tester rahasia123
  node make-user.js bosskizuna passwordkuat99 --admin
  node make-user.js tester2 rahasia123 --discord-id 123456789012345678
`);
  process.exit(1);
}

const u = validateUsername(rawUsername);
if (!u.ok) {
  console.error("Username tidak valid:", u.error);
  process.exit(1);
}

const p = validatePassword(rawPassword);
if (!p.ok) {
  console.error("Password tidak valid:", p.error);
  process.exit(1);
}

const hash = hashPassword(p.password);

// discord_id itu NOT NULL + UNIQUE di tabel. Untuk akun testing yang tidak
// terhubung ke Discord, dipakai penanda "manual:<username>" supaya tetap unik
// dan gampang dibedakan dari akun asli.
const discordId = flagValue("--discord-id") || `manual:${u.username}`;

// Escape kutip satu untuk literal SQL.
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

console.log(`
-- ============================================================
-- User: ${u.username}${isAdmin ? "  (ADMIN)" : ""}
-- Password: ${rawPassword}
-- discord_id: ${discordId}
--
-- Hash dibuat ${new Date().toISOString()} dengan scrypt.
-- Paste blok di bawah ke Supabase SQL Editor lalu Run.
-- ============================================================

insert into app_users (
  username, display_username, password_hash,
  discord_id, discord_username, is_admin
) values (
  ${q(u.username)},
  ${q(rawUsername.trim())},
  ${q(hash)},
  ${q(discordId)},
  ${q("(dibuat manual)")},
  ${isAdmin}
)
-- Kalau username-nya sudah ada, password & status admin di-update, dan
-- session_version dinaikkan supaya SEMUA sesi lama langsung ter-logout.
on conflict (username) do update set
  password_hash   = excluded.password_hash,
  is_admin        = excluded.is_admin,
  is_active       = true,
  session_version = app_users.session_version + 1,
  updated_at      = now();

-- Cek hasilnya:
select display_username, is_admin, is_active, device_label, session_version
from app_users where username = ${q(u.username)};
`);

console.error(`
Selesai. Login pakai:
  username : ${u.username}
  password : ${rawPassword}

Catatan device: perangkat PERTAMA yang dipakai login akan terikat ke akun ini.
Untuk pindah perangkat saat testing, jalankan SQL ini:

  update app_users
     set device_id = null, device_label = null, device_bound_at = null,
         session_version = session_version + 1
   where username = '${u.username}';
`);
