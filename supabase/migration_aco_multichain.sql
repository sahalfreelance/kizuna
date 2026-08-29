-- Jalanin di Supabase SQL Editor SETELAH migration_add_aco.sql.
--
-- Nambahin ke ACO:
--   1. Multi-chain    -> user pilih chain, tiap chain punya chain_id sendiri
--   2. Custom RPC     -> user simpan RPC sendiri per chain
--   3. OpenSea API key terkelola -> auto-refresh, tidak lagi hardcoded di .env

create extension if not exists "pgcrypto";


-- --------------------------------------------------------------- aco_rpcs
--
-- RPC milik user, satu baris per (user, chain).
--
-- RPC URL sering mengandung API key di path (mis. Alchemy/Infura), jadi
-- diperlakukan sebagai rahasia: dienkripsi sama seperti private key, dan
-- TIDAK PERNAH dikirim balik utuh ke browser -- yang ditampilkan cuma
-- hostname-nya (`display_host`) supaya user tahu ini RPC yang mana.
--
create table if not exists aco_rpcs (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references app_users (id) on delete cascade,

  -- Harus salah satu dari SUPPORTED_CHAINS di lib/chains.js
  chain text not null,

  -- Format: v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
  encrypted_url text not null,

  -- Cuma buat ditampilkan, mis. "eth-mainnet.g.alchemy.com". Bukan rahasia.
  display_host text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, chain)
);

create index if not exists aco_rpcs_user_idx on aco_rpcs (user_id);

alter table aco_rpcs enable row level security;


-- ------------------------------------------------------- kolom baru aco_jobs
--
-- chain sudah ada dari migration sebelumnya. Yang ditambah:
--   chain_id : angka EVM chain id, dipakai worker buat SIWE + kirim tx
--   rpc_url  : snapshot RPC user saat job dibuat (terenkripsi). Kalau NULL,
--              worker pakai RPC default dari .env-nya.
--
alter table aco_jobs add column if not exists chain_id integer;
alter table aco_jobs add column if not exists rpc_url text;


-- ------------------------------------------------------- opensea_api_keys
--
-- Pool API key OpenSea hasil POST /api/v2/auth/keys.
--
-- PENTING soal rate limit: endpoint itu dibatasi 2 key per hari per IP
-- (terverifikasi -- responsnya "Maximum 2 keys per day"). Jadi TIDAK MUNGKIN
-- bikin key baru tiap user login. Yang dilakukan: satu key dipakai bersama,
-- dan saat ada user login key itu diperiksa umurnya -- kalau sudah lewat
-- REFRESH_AFTER_DAYS baru diganti. Ini tetap mencegah key basi (kedaluwarsa
-- 30 hari) tanpa menabrak rate limit.
--
create table if not exists opensea_api_keys (
  id uuid primary key default gen_random_uuid(),

  -- Terenkripsi, formatnya sama dengan yang lain.
  encrypted_key text not null,

  -- 4 karakter terakhir, cuma buat identifikasi di log/UI admin.
  key_hint text,

  is_active boolean not null default true,

  -- Diisi dari respons OpenSea kalau ada; kalau tidak, ditaksir 30 hari
  -- dari created_at.
  expires_at timestamptz,

  -- Dipakai buat rate-limit sisi kita sendiri: jangan minta key baru kalau
  -- yang terakhir baru dibuat beberapa jam lalu.
  created_at timestamptz not null default now(),
  last_used_at timestamptz,

  rotated_reason text
);

-- Hanya boleh ada SATU key aktif. Partial unique index memaksa itu di level
-- database, bukan cuma di aplikasi.
create unique index if not exists opensea_api_keys_single_active
  on opensea_api_keys ((is_active))
  where is_active = true;

alter table opensea_api_keys enable row level security;


-- ------------------------------------------------------------------ helper
--
-- Ambil key aktif yang masih hidup. Balikin 0 baris kalau perlu di-refresh.
--
create or replace function opensea_active_key()
returns table (id uuid, encrypted_key text, created_at timestamptz, expires_at timestamptz)
language sql
stable
as $$
  select id, encrypted_key, created_at, expires_at
  from opensea_api_keys
  where is_active = true
    and (expires_at is null or expires_at > now())
  limit 1;
$$;
