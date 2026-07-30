-- Jalanin ini di Supabase SQL Editor.
-- Nambahin kategori MINT (buat mint info bar) dan kolom secondary_link
-- (dipakai buat nyimpen link Twitter/X kalau ada, terpisah dari link utama).

alter table garapan drop constraint if exists garapan_category_check;
alter table garapan add constraint garapan_category_check
  check (category in ('CRYPTO', 'NFT', 'RAFFLE', 'MINT'));

alter table garapan add column if not exists secondary_link text;
