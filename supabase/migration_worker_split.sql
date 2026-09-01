-- Memisahkan worker per platform.
--
-- Masalahnya: `aco_claim_job` mengambil job QUEUED apa pun. Kalau worker OpenSea
-- dan worker contract jalan bersamaan, keduanya berebut job yang bukan
-- urusannya — worker contract bisa mengambil job OpenSea lalu gagal karena
-- tidak punya API key, dan sebaliknya.
--
-- Solusinya: klaim disaring per platform. Tiap worker menyatakan platform apa
-- yang dia tangani lewat env WORKER_PLATFORMS.
--
-- Fungsi lama HARUS di-drop dulu: menambah parameter dengan DEFAULT membuat
-- pemanggilan 1-argumen jadi ambigu (Postgres tidak bisa memilih antara versi
-- 1-arg dan 2-arg-berdefault).

drop function if exists aco_claim_job(text);

-- p_platforms null / array kosong = ambil platform apa pun (perilaku lama,
-- supaya worker versi lama tetap jalan kalau belum di-update).
create or replace function aco_claim_job(
  p_worker    text,
  p_platforms text[] default null
)
returns setof aco_jobs as $$
begin
  return query
  with pick as (
    select id
      from aco_jobs
     where status = 'QUEUED'
       and (
         p_platforms is null
         or array_length(p_platforms, 1) is null
         or platform = any (p_platforms)
       )
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

-- Index untuk pola klaim baru: status + platform + urutan jadwal.
create index if not exists aco_jobs_claim_idx
  on aco_jobs (status, platform, stage_start_time, created_at);
