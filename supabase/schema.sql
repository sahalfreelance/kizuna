-- Jalankan ini di Supabase SQL Editor (project kalian) sekali di awal setup.

create extension if not exists "pgcrypto";

create table if not exists garapan (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  category text not null check (category in ('CRYPTO', 'NFT', 'RAFFLE', 'MINT')),
  status text check (status in ('LIVE', 'PAST')), -- dipakai khusus kategori RAFFLE
  expires_at timestamptz, -- dipakai buat auto-expire raffle LIVE -> PAST
  link text,
  secondary_link text, -- dipakai khusus kategori MINT (link Twitter/X)
  image_url text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists garapan_category_idx on garapan (category);
create index if not exists garapan_status_idx on garapan (status);

-- Kita akses tabel ini cuma lewat server (service role key), jadi RLS
-- dikunci total dari akses publik/anon langsung.
alter table garapan enable row level security;
