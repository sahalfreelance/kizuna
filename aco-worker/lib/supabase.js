import { createClient } from "@supabase/supabase-js";

/**
 * Klien Supabase untuk worker.
 *
 * Env yang kurang dilaporkan lewat `supabaseConfigError`, BUKAN dengan throw
 * saat import — throw di top-level module menghasilkan stack trace panjang
 * yang menutupi pesan aslinya. worker.js yang memeriksanya lalu mencetak
 * pesan yang bisa dibaca orang.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseConfigError = !url
  ? "NEXT_PUBLIC_SUPABASE_URL belum di-set di aco-worker/.env"
  : !key
  ? "SUPABASE_SERVICE_ROLE_KEY belum di-set di aco-worker/.env"
  : null;

// Placeholder dipakai kalau env belum lengkap, supaya import tidak meledak.
// worker.js berhenti lebih dulu sebelum klien ini benar-benar dipanggil.
export const supabase = createClient(
  url || "https://placeholder.supabase.co",
  key || "placeholder",
  { auth: { persistSession: false } }
);
