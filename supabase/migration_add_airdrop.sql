-- Jalanin ini di Supabase SQL Editor buat nambahin kategori AIRDROP
-- ke tabel garapan yang udah ada (gak perlu bikin tabel baru / hilangin data lama).

alter table garapan drop constraint if exists garapan_category_check;
alter table garapan add constraint garapan_category_check
  check (category in ('CRYPTO', 'NFT', 'RAFFLE', 'AIRDROP'));
