-- Jalanin ini di Supabase SQL Editor buat nambahin kolom expires_at,
-- dipakai buat auto-expire raffle dari LIVE ke PAST.

alter table garapan add column if not exists expires_at timestamptz;
create index if not exists garapan_expires_at_idx on garapan (expires_at);
