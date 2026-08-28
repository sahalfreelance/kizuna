import { supabase } from "./supabase.js";

/**
 * Logger job: menulis ke tabel aco_logs supaya user bisa melihat progres di
 * website tanpa akses ke VPS. Sekaligus mencetak ke stdout untuk `pm2 logs`.
 *
 * Penulisan log TIDAK boleh menggagalkan mint — kalau insert gagal (jaringan,
 * dsb), errornya dicatat ke konsol lalu jalan terus.
 */

const PREFIX = {
  INFO: "[INFO]",
  OK: "[ OK ]",
  WARN: "[WARN]",
  ERROR: "[ERR ]",
};

export function createJobLogger(jobId) {
  async function write(level, message, walletAddress = null) {
    const line = `${PREFIX[level] || "[INFO]"} ${
      walletAddress ? `[${walletAddress.slice(0, 8)}…] ` : ""
    }${message}`;
    console.log(`  ${line}`);

    try {
      await supabase.from("aco_logs").insert({
        job_id: jobId,
        level,
        message: String(message).slice(0, 2000),
        wallet_address: walletAddress,
      });
    } catch (err) {
      console.error(`  [logger] gagal tulis log: ${err?.message ?? err}`);
    }
  }

  return {
    info: (m, w) => write("INFO", m, w),
    ok: (m, w) => write("OK", m, w),
    warn: (m, w) => write("WARN", m, w),
    error: (m, w) => write("ERROR", m, w),
  };
}
