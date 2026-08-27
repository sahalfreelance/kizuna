const { createClient } = require("@supabase/supabase-js");

// Bot pakai service role key — sama seperti website — karena tabel app_users
// dikunci RLS total dari akses anon.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error(
    "[bot] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set. " +
      "Command /register, /reset-device, /change-password tidak akan jalan."
  );
}

const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: false } })
  : null;

module.exports = { supabase };
