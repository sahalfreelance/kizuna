-- Jalanin di Supabase SQL Editor SETELAH migration_aco_user_keys.sql.
--
-- Tiga hal:
--   1. Multi-platform  -> aco_jobs.platform (opensea / scatter / contract)
--   2. Anti-revert     -> catatan hasil simulasi sebelum tx dikirim
--   3. RPC fallback    -> user bisa simpan beberapa RPC per chain

create extension if not exists "pgcrypto";


-- ------------------------------------------------- platform di aco_jobs
--
-- ACO sekarang untuk OpenSea. Scatter dan mint-by-contract menyusul, jadi
-- kolomnya disiapkan sekarang supaya job lama tidak perlu dimigrasi lagi.
--
alter table aco_jobs
  add column if not exists platform text not null default 'opensea';

-- Constraint dipasang terpisah supaya migration aman diulang.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'aco_jobs_platform_check'
  ) then
    alter table aco_jobs
      add constraint aco_jobs_platform_check
      check (platform in ('opensea', 'scatter', 'contract'));
  end if;
end $$;

create index if not exists aco_jobs_platform_idx on aco_jobs (platform, created_at desc);

-- Konfigurasi khusus platform. Untuk 'contract' nanti isinya ABI, nama
-- fungsi, argumen, harga per item, dsb. Untuk 'opensea' biasanya null.
alter table aco_jobs add column if not exists platform_config jsonb;


-- ------------------------------------------------------- anti-revert
--
-- Hasil simulasi eth_call sebelum tx benar-benar dikirim. Disimpan supaya
-- kelihatan di UI kenapa sebuah job tidak mengirim transaksi sama sekali —
-- itu justru keberhasilan (gas tidak terbuang), bukan kegagalan.
--
alter table aco_jobs add column if not exists preflight jsonb;

-- Kalau true, tx TIDAK dikirim ketika simulasi memperkirakan revert.
-- Default true: lebih baik tidak mint daripada membuang gas untuk tx gagal.
alter table aco_jobs
  add column if not exists abort_on_revert boolean not null default true;

-- Berapa kali percobaan mint diulang saat error yang bisa dicoba lagi.
alter table aco_jobs
  add column if not exists max_attempts integer not null default 3;


-- --------------------------------------------------- RPC fallback
--
-- Sebelumnya satu RPC per (user, chain). Sekarang boleh beberapa, dengan
-- prioritas: kalau RPC utama gagal/lambat, worker pindah ke berikutnya
-- tanpa menggagalkan job.
--
alter table aco_rpcs add column if not exists priority integer not null default 0;

-- Statistik ringan supaya user tahu RPC mana yang sering bermasalah.
alter table aco_rpcs add column if not exists fail_count integer not null default 0;
alter table aco_rpcs add column if not exists last_ok_at timestamptz;
alter table aco_rpcs add column if not exists last_fail_at timestamptz;
alter table aco_rpcs add column if not exists last_error text;

-- Unique (user_id, chain) yang lama harus dilepas supaya satu chain bisa
-- punya beberapa RPC.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'aco_rpcs_user_id_chain_key'
  ) then
    alter table aco_rpcs drop constraint aco_rpcs_user_id_chain_key;
  end if;
end $$;

-- Ganti dengan unique per (user, chain, prioritas) supaya urutannya tegas.
create unique index if not exists aco_rpcs_user_chain_priority
  on aco_rpcs (user_id, chain, priority);

create index if not exists aco_rpcs_lookup_idx
  on aco_rpcs (user_id, chain, priority);


-- ------------------------------------------- percobaan per job (audit)
--
-- Satu baris per percobaan mint per wallet. Ini yang membuat auto-retry bisa
-- diaudit: kelihatan percobaan ke berapa yang berhasil, error apa yang
-- membuat percobaan sebelumnya diulang, dan RPC mana yang dipakai.
--
create table if not exists aco_attempts (
  id bigserial primary key,

  job_id uuid not null references aco_jobs (id) on delete cascade,

  wallet_address text not null,
  attempt integer not null,

  -- PREFLIGHT_FAIL | SENT | REVERTED | SUCCESS | ERROR | SKIPPED
  outcome text not null,

  tx_hash text,
  error_kind text,      -- klasifikasi: RATE_LIMIT | RPC_DOWN | NOT_LIVE | ...
  error_message text,
  rpc_host text,        -- host saja, bukan URL penuh (URL mengandung API key)

  gas_used bigint,
  duration_ms integer,

  created_at timestamptz not null default now()
);

create index if not exists aco_attempts_job_idx on aco_attempts (job_id, id);

alter table aco_attempts enable row level security;
