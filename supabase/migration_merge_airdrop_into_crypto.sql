-- Jalanin ini di Supabase SQL Editor.
-- Kategori "CRYPTO" lama gak kepake (gak ada forwarder-nya), jadi kita
-- gabung: semua data yang tadinya "AIRDROP" dipindah jadi "CRYPTO",
-- terus constraint-nya diperbarui biar cuma CRYPTO/NFT/RAFFLE yang valid.

update garapan set category = 'CRYPTO' where category = 'AIRDROP';

alter table garapan drop constraint if exists garapan_category_check;
alter table garapan add constraint garapan_category_check
  check (category in ('CRYPTO', 'NFT', 'RAFFLE'));
