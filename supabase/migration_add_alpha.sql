-- Jalanin ini di Supabase SQL Editor (sekali aja).
--
-- Nambahin dukungan buat halaman /alpha (data dari Alphagate):
--   1. Kolom `source_id` di tabel `garapan` -> dedup PERMANEN buat kategori NFT
--   2. Tabel `alpha_items` -> nyimpen trending/news/feed (bukan garapan)

-- ---------------------------------------------------------------- 1. garapan
-- Dedup lama cuma ngecek link+category dalam 5 menit terakhir, jadi kalau
-- forwarder jalan tiap 15 menit project yang sama tetep masuk berulang.
-- `source_id` bikin database sendiri yang nolak duplikat, permanen.
alter table garapan add column if not exists source_id text;

-- UNIQUE (bukan cuma index biasa) supaya INSERT duplikat langsung gagal di
-- level database. NULL tetep boleh berkali-kali -> data lama & input manual
-- admin nggak keganggu.
create unique index if not exists garapan_source_id_key
  on garapan (source_id)
  where source_id is not null;

-- ------------------------------------------------------------ 2. alpha_items
create table if not exists alpha_items (
  id uuid primary key default gen_random_uuid(),

  -- section di halaman /alpha: TRENDING | NEWS | FEED
  section text not null check (section in ('TRENDING', 'NEWS', 'FEED')),

  -- sumber asli di Alphagate, buat sub-tab & badge
  source text not null check (source in ('trending', 'launches', 'summary', 'notes', 'tweets')),

  -- dedup permanen. Formatnya "<source>:<id_alphagate>"
  source_id text not null unique,

  title text not null,
  description text not null default '',

  -- profil X-nya
  username text,
  display_name text,
  avatar_url text,
  image_url text,

  link text,            -- link utama (tweet / profil X)
  secondary_link text,  -- website project kalau ada

  -- metrik Alphagate
  followers_count integer,
  key_followers_count integer,
  followers_when_found integer,
  key_followers_growth_1d integer,
  key_followers_growth_3d integer,
  key_followers_growth_7d integer,

  tags text[] not null default '{}',
  chains text[] not null default '{}',
  contracts text[] not null default '{}',

  -- kategori hasil klasifikasi (NFT/CRYPTO), buat badge + filter
  category text check (category in ('NFT', 'CRYPTO')),

  -- true kalau item ini udah di-push ke tabel `garapan` (khusus NFT)
  pushed_to_garapan boolean not null default false,

  -- waktu asli dari Alphagate (bukan waktu insert), buat sorting
  source_timestamp timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists alpha_items_section_idx on alpha_items (section);
create index if not exists alpha_items_source_idx on alpha_items (source);
create index if not exists alpha_items_ts_idx on alpha_items (source_timestamp desc);
create index if not exists alpha_items_category_idx on alpha_items (category);

-- Diakses cuma lewat server (service role key), sama kayak tabel garapan.
alter table alpha_items enable row level security;
