-- Jalanin di Supabase SQL Editor SETELAH migration_aco_eligibility.sql.
--
-- Job paralel + heartbeat.
--
-- Dua masalah yang diperbaiki:
--
--   1. Job diproses SATU PER SATU. Karena `processJob` menunggu window mint
--      (bisa berjam-jam), job lain tertahan di QUEUED sampai kelewat. Job
--      dengan jadwal lebih awal bisa kalah dari job yang diambil lebih dulu.
--
--   2. `releaseStuckJobs` menggagalkan job CLAIMED/RUNNING yang lebih tua dari
--      30 menit. Job yang SAH sedang menunggu window 6 jam ke depan ikut
--      dibunuh dan ditandai "nyangkut" — jadi menjadwalkan mint lebih dari 30
--      menit di depan sebenarnya tidak pernah bisa berhasil.
--
-- Solusinya: heartbeat. Job yang hidup memperbarui `heartbeat_at` secara
-- berkala, jadi yang dibersihkan hanya job yang benar-benar mati (worker crash
-- atau restart), bukan yang sedang menunggu.

alter table aco_jobs
  add column if not exists heartbeat_at timestamptz;

-- Job yang sudah diambil worker tapi belum selesai — dipakai untuk mendeteksi
-- job mati tanpa memindai seluruh tabel.
create index if not exists aco_jobs_heartbeat_idx
  on aco_jobs (heartbeat_at)
  where status in ('CLAIMED', 'RUNNING');

-- Job lama yang sudah CLAIMED sebelum migration ini belum punya heartbeat.
-- Diisi dengan claimed_at supaya tidak langsung dianggap mati.
update aco_jobs
   set heartbeat_at = coalesce(claimed_at, updated_at, created_at)
 where status in ('CLAIMED', 'RUNNING')
   and heartbeat_at is null;


-- ------------------------------------------------- klaim job aman & atomik
--
-- Dulu worker SELECT lalu UPDATE terpisah. Dengan job paralel, dua worker (atau
-- dua tick dari worker yang sama) bisa mengambil kandidat yang sama sebelum
-- salah satunya sempat menandai. Guard `.eq(status,'QUEUED')` memang menahannya,
-- tapi ini membuang round-trip.
--
-- Fungsi ini mengklaim dalam SATU pernyataan. `for update skip locked` membuat
-- pemanggil paralel otomatis melewati baris yang sedang dikunci pemanggil lain,
-- jadi tidak ada tabrakan dan tidak ada yang menunggu.
--
-- Urutan pengambilan diubah: yang jadwalnya PALING DEKAT didahulukan, bukan
-- yang dibuat paling awal. Ini inti perbaikannya — job yang mau mint 10 menit
-- lagi harus menang dari job yang mau mint 6 jam lagi, walau dibuat belakangan.
create or replace function aco_claim_job(p_worker text)
returns setof aco_jobs as $$
begin
  return query
  with pick as (
    select id
      from aco_jobs
     where status = 'QUEUED'
     order by stage_start_time asc nulls last, created_at asc
     limit 1
       for update skip locked
  )
  update aco_jobs j
     set status       = 'CLAIMED',
         claimed_by   = p_worker,
         claimed_at   = now(),
         heartbeat_at = now(),
         updated_at   = now()
    from pick
   where j.id = pick.id
  returning j.*;
end;
$$ language plpgsql;


-- ------------------------------------------------------- deteksi job mati
--
-- Ambang 3 menit: worker memperbarui heartbeat tiap ~30 detik, jadi 3 menit
-- tanpa kabar berarti prosesnya benar-benar hilang. Job yang sedang menunggu
-- window berjam-jam TIDAK tersentuh karena heartbeat-nya tetap jalan.
create or replace function aco_release_dead_jobs(p_stale_seconds int default 180)
returns int as $$
declare
  n int;
begin
  with dead as (
    update aco_jobs
       set status        = 'FAILED',
           error_message = 'Worker berhenti di tengah jalan (heartbeat hilang)',
           finished_at   = now(),
           updated_at    = now()
     where status in ('CLAIMED', 'RUNNING')
       and coalesce(heartbeat_at, claimed_at) < now() - make_interval(secs => p_stale_seconds)
    returning 1
  )
  select count(*) into n from dead;

  return n;
end;
$$ language plpgsql;
