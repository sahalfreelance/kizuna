-- Jalanin ini di Supabase SQL Editor (sekali aja).
--
-- Tools ACO (Auto Checkout / auto-mint OpenSea) versi multi-user.
--
-- Arsitektur: website = panel kontrol, worker di VPS = eksekutor.
--   User kelola wallet & bikin job di /aco  -> baris di aco_jobs (status QUEUED)
--   Worker VPS polling aco_jobs tiap 5 detik -> eksekusi -> tulis aco_logs
--   Website polling aco_logs -> user lihat progres realtime
--
-- CATATAN KEAMANAN private key ada di komentar tabel aco_wallets di bawah.

create extension if not exists "pgcrypto";


-- ---------------------------------------------------------------- aco_wallets
--
-- PENTING: kolom `encrypted_key` berisi private key yang dienkripsi
-- AES-256-GCM di sisi aplikasi (lihat lib/walletCrypto.js). Kunci enkripsinya
-- ada di environment variable WALLET_ENCRYPTION_KEY, TIDAK di database ini.
-- Jadi bocornya dump database saja tidak cukup untuk mencuri wallet.
--
-- Private key TIDAK PERNAH dikirim balik ke browser. Tidak ada endpoint yang
-- membacanya; yang ditampilkan cuma `address`. Dekripsi hanya terjadi di
-- worker VPS, di memori, saat mint jalan.
--
create table if not exists aco_wallets (
  id uuid primary key default gen_random_uuid(),

  -- Pemilik wallet. Dihapus akunnya -> wallet ikut terhapus.
  user_id uuid not null references app_users (id) on delete cascade,

  label text,
  address text not null,

  -- Format: v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
  encrypted_key text not null,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Satu address cukup sekali per user. Kalau mau ganti private key-nya,
  -- hapus lalu import ulang.
  unique (user_id, address)
);

create index if not exists aco_wallets_user_idx on aco_wallets (user_id);

alter table aco_wallets enable row level security;


-- ------------------------------------------------------------------ aco_jobs
create table if not exists aco_jobs (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references app_users (id) on delete cascade,

  -- Target mint
  slug text not null,
  contract_address text,
  chain text,

  -- Stage pilihan user. Disimpan snapshot-nya, bukan cuma index — stage di
  -- OpenSea bisa berubah/bergeser antara saat user submit dan saat eksekusi.
  stage_index integer,
  stage_label text,
  stage_type text,
  stage_start_time timestamptz,
  stage_end_time timestamptz,
  price_unit text,

  mint_amount integer not null default 1,
  gas_limit integer not null default 300000,

  -- Wallet mana saja yang dipakai. Array id dari aco_wallets.
  wallet_ids uuid[] not null default '{}',

  -- QUEUED   : nunggu diambil worker
  -- CLAIMED  : worker sudah ambil, sedang login/nunggu window
  -- RUNNING  : sedang mint
  -- DONE     : selesai (lihat result_summary buat sukses/gagalnya)
  -- FAILED   : error fatal sebelum/selama mint
  -- CANCELLED: dibatalkan user
  status text not null default 'QUEUED'
    check (status in ('QUEUED','CLAIMED','RUNNING','DONE','FAILED','CANCELLED')),

  -- Diisi worker saat claim. Dipakai buat mendeteksi job nyangkut: kalau
  -- claimed_at sudah lama tapi status masih CLAIMED, worker-nya mati.
  claimed_by text,
  claimed_at timestamptz,

  started_at timestamptz,
  finished_at timestamptz,

  error_message text,

  -- Ringkasan hasil per wallet: [{address, success, txHash, error}]
  result_summary jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists aco_jobs_user_idx on aco_jobs (user_id, created_at desc);
-- Index yang dipakai worker buat cari kerjaan. Partial supaya tetap kecil
-- walaupun tabelnya nanti berisi ribuan job selesai.
create index if not exists aco_jobs_queued_idx on aco_jobs (created_at)
  where status = 'QUEUED';

alter table aco_jobs enable row level security;


-- ------------------------------------------------------------------ aco_logs
--
-- Log per job. Worker menulis, website membaca (polling) supaya user lihat
-- progres realtime tanpa akses ke VPS.
--
create table if not exists aco_logs (
  id bigserial primary key,

  job_id uuid not null references aco_jobs (id) on delete cascade,

  -- INFO | OK | WARN | ERROR
  level text not null default 'INFO'
    check (level in ('INFO','OK','WARN','ERROR')),

  message text not null,

  -- Kalau log ini spesifik ke satu wallet. Cuma address, JANGAN private key.
  wallet_address text,

  created_at timestamptz not null default now()
);

create index if not exists aco_logs_job_idx on aco_logs (job_id, id);

alter table aco_logs enable row level security;


-- ------------------------------------------------------------- housekeeping
--
-- Job yang di-claim tapi tidak selesai dalam 30 menit dianggap nyangkut
-- (worker mati/restart di tengah jalan). Jalanin manual kalau perlu, atau
-- panggil dari worker saat start.
--
create or replace function aco_release_stuck_jobs()
returns integer
language plpgsql
as $$
declare
  affected integer;
begin
  update aco_jobs
     set status = 'FAILED',
         error_message = 'Worker berhenti di tengah jalan (job nyangkut > 30 menit)',
         finished_at = now(),
         updated_at = now()
   where status in ('CLAIMED','RUNNING')
     and claimed_at < now() - interval '30 minutes';

  get diagnostics affected = row_count;
  return affected;
end;
$$;
