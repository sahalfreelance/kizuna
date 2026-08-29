-- Jalanin di Supabase SQL Editor SETELAH migration_aco_platforms.sql.
--
-- Eligibility checker OpenSea drops.
--
-- Kenapa perlu tabel sendiri, tidak langsung dari website:
--   Field isEligible / eligibleMaxTotalMintableByWallet di gql.opensea.io
--   DIKUNCI di balik auth. Terverifikasi:
--     tanpa auth  -> UNAUTHORIZED @ stages.isEligible
--     dengan SIWE -> field terbuka
--   Artinya checker harus SIWE login pakai private key wallet, dan itu hanya
--   boleh terjadi di worker VPS (tempat private key didekripsi). Website cuma
--   menitipkan permintaan lewat tabel ini, lalu menunggu hasilnya.

create extension if not exists "pgcrypto";


-- ------------------------------------------- cache session SIWE per wallet
--
-- Login SIWE butuh ~2 detik per wallet. Kalau tiap klik "CEK" login ulang,
-- checker jadi lambat dan gampang kena rate limit opensea.io. Cookie session
-- disimpan terenkripsi dan dipakai ulang sampai mendekati kedaluwarsa.
--
create table if not exists aco_siwe_sessions (
  id uuid primary key default gen_random_uuid(),

  wallet_id uuid not null references aco_wallets (id) on delete cascade,
  address text not null,

  -- Cookie string lengkap, terenkripsi AES-256-GCM (format v1:<iv>:<tag>:<ct>).
  -- Ini berisi access_token JWT — setara sesi login, jadi TIDAK boleh plaintext.
  encrypted_cookies text not null,

  expires_at timestamptz not null,
  created_at timestamptz not null default now(),

  -- Satu session aktif per wallet.
  unique (wallet_id)
);

create index if not exists aco_siwe_sessions_wallet_idx on aco_siwe_sessions (wallet_id);

alter table aco_siwe_sessions enable row level security;


-- -------------------------------------------------- permintaan pengecekan
create table if not exists aco_elig_checks (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references app_users (id) on delete cascade,

  slug text not null,
  platform text not null default 'opensea',

  -- Wallet yang mau dicek. Kalau kosong, semua wallet user dipakai.
  wallet_ids uuid[] not null default '{}',

  -- QUEUED | CLAIMED | DONE | FAILED
  status text not null default 'QUEUED',

  -- Bentuk hasil:
  -- {
  --   "collection": { "name": "...", "chain": "base", "contractAddress": "0x.." },
  --   "wallets": [ { "walletId": "..", "address": "0x..", "label": "w1",
  --                  "ok": true, "error": null,
  --                  "stages": [ { "stageIndex": 0, "label": "FCFS",
  --                                "eligible": true, "maxMintable": 2 } ] } ],
  --   "stages": [ { "stageIndex": 0, "label": "FCFS", "startTime": "...",
  --                 "eligibleCount": 1, "totalWallets": 2 } ]
  -- }
  result jsonb,
  error_message text,

  claimed_by text,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists aco_elig_checks_queue_idx
  on aco_elig_checks (status, created_at)
  where status = 'QUEUED';

create index if not exists aco_elig_checks_user_idx
  on aco_elig_checks (user_id, created_at desc);

alter table aco_elig_checks enable row level security;


-- Hasil pengecekan basi tidak berguna (allowlist bisa berubah, stage bergeser).
-- Fungsi ini dipanggil worker sesekali; tidak ada cron yang perlu diatur.
create or replace function aco_prune_elig_checks() returns void as $$
begin
  delete from aco_elig_checks where created_at < now() - interval '2 hours';
  delete from aco_siwe_sessions where expires_at < now();
end;
$$ language plpgsql;
