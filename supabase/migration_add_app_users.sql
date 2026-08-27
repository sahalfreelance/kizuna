-- Jalanin ini di Supabase SQL Editor (sekali aja).
--
-- Login baru: username + password, akun dibuat lewat bot Discord.
-- Aturan: 1 akun Discord = 1 username = 1 device.

create extension if not exists "pgcrypto";

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),

  -- username disimpan LOWERCASE biar "Budi" dan "budi" nggak jadi 2 akun.
  -- Perbandingan saat login juga di-lowercase dulu di sisi aplikasi.
  username text not null unique,
  -- Bentuk asli yang user ketik, cuma buat ditampilkan.
  display_username text not null,

  -- Format: scrypt$N$r$p$<salt_b64>$<hash_b64>. Password mentah TIDAK PERNAH
  -- disimpan. Lihat lib/localAuth.js.
  password_hash text not null,

  -- 1 akun Discord cuma boleh punya 1 username.
  discord_id text not null unique,
  discord_username text,

  -- Device yang di-bind. NULL = belum pernah login / abis di-reset.
  device_id text,
  device_label text,
  device_bound_at timestamptz,

  -- Dinaikin tiap ganti password / reset device / dinonaktifkan.
  -- Token sesi bawa angka ini; kalau nggak cocok, token dianggap mati.
  -- Ini yang bikin logout paksa bisa jalan tanpa nyimpen daftar token.
  session_version integer not null default 1,

  is_admin boolean not null default false,
  is_active boolean not null default true,

  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Satu device fisik cuma boleh dipakai satu akun (1 user 1 device).
-- Partial index: NULL boleh berkali-kali, jadi akun yang belum bind aman.
create unique index if not exists app_users_device_id_key
  on app_users (device_id)
  where device_id is not null;

create index if not exists app_users_discord_id_idx on app_users (discord_id);

-- Diakses cuma lewat server (service role key), sama kayak tabel lain.
alter table app_users enable row level security;

-- Catatan audit login: buat lihat percobaan login gagal / device ditolak.
create table if not exists app_login_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users (id) on delete set null,
  username text,
  device_id text,
  -- OK | BAD_PASSWORD | NO_USER | DEVICE_MISMATCH | DEVICE_TAKEN | INACTIVE
  result text not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists app_login_events_created_idx
  on app_login_events (created_at desc);

alter table app_login_events enable row level security;
