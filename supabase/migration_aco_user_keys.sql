-- Jalanin di Supabase SQL Editor SETELAH migration_aco_multichain.sql.
--
-- API key OpenSea PER USER.
--
-- Kenapa per user, bukan satu key bersama:
--   1. Rate limit pembuatan key = 2/hari per IP. Kalau server yang minta,
--      semua user berbagi kuota IP server dan cepat habis. Kalau BROWSER USER
--      yang minta, kuota terpakai dari IP user masing-masing.
--      (Terverifikasi: endpoint /api/v2/auth/keys mengizinkan CORS dari origin
--      mana pun, jadi fetch dari browser memang bisa.)
--   2. Rate limit PEMAKAIAN key juga per key. Satu key dipakai bersama =
--      saat beberapa user mint bersamaan, request saling berebut kuota dan
--      sebagian gagal. Satu key per user menghilangkan bentrok itu.

create extension if not exists "pgcrypto";

create table if not exists aco_user_keys (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references app_users (id) on delete cascade,

  -- Terenkripsi AES-256-GCM: v1:<iv>:<tag>:<ciphertext>
  encrypted_key text not null,

  -- 4 karakter terakhir, buat ditampilkan di UI. Bukan rahasia.
  key_hint text,

  -- Dari respons OpenSea kalau ada; kalau tidak, ditaksir 30 hari.
  expires_at timestamptz,

  -- Kapan terakhir key ini benar-benar dipakai worker.
  last_used_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Satu key aktif per user. Refresh = update baris yang sama, bukan insert
  -- baris baru, supaya tidak menumpuk key mati.
  unique (user_id)
);

create index if not exists aco_user_keys_user_idx on aco_user_keys (user_id);

alter table aco_user_keys enable row level security;


-- Job menyimpan pemiliknya (user_id) sejak awal, jadi worker bisa mengambil
-- key milik user itu. Tidak ada kolom baru yang dibutuhkan.
--
-- Tabel opensea_api_keys dari migration sebelumnya tetap ada dan dipakai
-- sebagai CADANGAN: kalau user belum punya key sendiri, worker jatuh ke key
-- bersama itu supaya job tidak langsung gagal.
