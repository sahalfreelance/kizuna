-- ============================================================================
-- SQL bantu buat TESTING login username+password
--
-- CATATAN PENTING: file ini TIDAK bisa dipakai untuk bikin password baru.
-- Password disimpan sebagai hash scrypt, dan Postgres tidak punya scrypt
-- (pgcrypto cuma punya bcrypt lewat crypt()). Jadi hash-nya HARUS dibuat di
-- Node dengan format yang sama seperti aplikasi:
--
--     cd bot && node make-user.js <username> <password> [--admin]
--
-- Script itu mencetak INSERT yang tinggal di-paste ke SQL Editor.
--
-- Isi file ini: user siap pakai untuk testing + query-query bantu.
-- ============================================================================


-- ---------------------------------------------------------------- 1. USER SIAP PAKAI
-- Dua akun testing. Hash di bawah asli, sudah diverifikasi cocok.
--
--   username: tester      password: rahasia123     (admin)
--   username: tester2     password: rahasia123     (user biasa)
--
-- discord_id diisi "manual:<username>" karena kolomnya NOT NULL + UNIQUE.
-- Prefix "manual:" bikin akun testing gampang dibedakan dari akun asli.

insert into app_users (
  username, display_username, password_hash,
  discord_id, discord_username, is_admin
) values
  (
    'tester', 'tester',
    'scrypt$16384$8$1$MQlxCRhB6afoBqen8TrBVQ==$ZLv/xQ1ZBV/FdXuBZaxaX1Dz64Lx72G3OeOivdmQhboDe4NZxMIlSMkBCaFc3dX8db1RQg3KNZtMebLFhum5yw==',
    'manual:tester', '(dibuat manual)', true
  ),
  (
    'tester2', 'tester2',
    'scrypt$16384$8$1$MQlxCRhB6afoBqen8TrBVQ==$ZLv/xQ1ZBV/FdXuBZaxaX1Dz64Lx72G3OeOivdmQhboDe4NZxMIlSMkBCaFc3dX8db1RQg3KNZtMebLFhum5yw==',
    'manual:tester2', '(dibuat manual)', false
  )
on conflict (username) do update set
  password_hash   = excluded.password_hash,
  is_admin        = excluded.is_admin,
  is_active       = true,
  -- dinaikkan supaya sesi lama (kalau ada) langsung mati
  session_version = app_users.session_version + 1,
  updated_at      = now();


-- ---------------------------------------------------------------- 2. LIHAT DAFTAR USER
select
  display_username        as username,
  case when discord_id like 'manual:%' then '(testing)' else discord_username end as discord,
  coalesce(device_label, '— belum terikat —') as device,
  is_admin, is_active, session_version,
  last_login_at, created_at
from app_users
order by created_at desc;


-- ---------------------------------------------------------------- 3. RESET DEVICE
-- Dipakai kalau kena "Akun ini sudah terikat ke perangkat lain" saat testing
-- dari browser/HP kedua. Efeknya sama dengan /reset-device di bot.
-- session_version dinaikkan -> sesi di perangkat lama langsung ter-logout.

update app_users
   set device_id       = null,
       device_label    = null,
       device_bound_at = null,
       session_version = session_version + 1,
       updated_at      = now()
 where username = 'tester';        -- <<< ganti


-- Reset device SEMUA akun testing sekaligus:
-- update app_users
--    set device_id = null, device_label = null, device_bound_at = null,
--        session_version = session_version + 1, updated_at = now()
--  where discord_id like 'manual:%';


-- ---------------------------------------------------------------- 4. JADIKAN ADMIN
-- session_version dinaikkan supaya token lama (yang isinya adm=0) mati dan
-- user login ulang dengan token yang membawa hak admin.

update app_users
   set is_admin = true,
       session_version = session_version + 1,
       updated_at = now()
 where username = 'tester';        -- <<< ganti


-- ---------------------------------------------------------------- 5. LOGOUT PAKSA
-- Menaikkan session_version = semua token user itu langsung tidak berlaku,
-- tanpa mengubah password dan tanpa melepas ikatan device.

update app_users
   set session_version = session_version + 1, updated_at = now()
 where username = 'tester';        -- <<< ganti

-- Logout paksa SEMUA user:
-- update app_users set session_version = session_version + 1, updated_at = now();


-- ---------------------------------------------------------------- 6. NONAKTIFKAN / AKTIFKAN
update app_users
   set is_active = false, session_version = session_version + 1, updated_at = now()
 where username = 'tester';        -- <<< ganti

-- Aktifkan lagi:
-- update app_users set is_active = true, updated_at = now()
--  where username = 'tester';


-- ---------------------------------------------------------------- 7. AUDIT LOGIN
-- Ini yang dipakai buat MEMBUKTIKAN aturan 1-user-1-device jalan.
-- result: OK | BAD_PASSWORD | NO_USER | DEVICE_MISMATCH | DEVICE_TAKEN | INACTIVE

select username, result, device_id, ip, created_at
from app_login_events
order by created_at desc
limit 30;

-- Ringkasan per hasil, 24 jam terakhir:
select result, count(*) as jumlah
from app_login_events
where created_at > now() - interval '24 hours'
group by result
order by jumlah desc;

-- Khusus penolakan device:
select username, device_id, result, created_at
from app_login_events
where result in ('DEVICE_MISMATCH', 'DEVICE_TAKEN')
order by created_at desc
limit 20;


-- ---------------------------------------------------------------- 8. BERSIH-BERSIH
-- Hapus semua akun testing (yang discord_id-nya berprefix "manual:").
-- Akun asli dari /register TIDAK tersentuh.

-- delete from app_users where discord_id like 'manual:%';

-- Kosongkan log login:
-- truncate app_login_events;


-- ---------------------------------------------------------------- 9. CEK MIGRATION
-- Pastikan struktur tabelnya benar sebelum menyalahkan aplikasi.

-- kedua tabel harus ada
select table_name from information_schema.tables
where table_name in ('app_users', 'app_login_events');

-- app_users_device_id_key WAJIB ada — itu yang menegakkan 1 device 1 user
select indexname from pg_indexes where tablename = 'app_users';
