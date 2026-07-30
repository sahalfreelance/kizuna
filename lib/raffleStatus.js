// Raffle disimpen di database dengan status LIVE/PAST yang di-set sekali
// pas bot/admin nambahin datanya. Tapi kalau ada expires_at (waktu berakhir
// yang berhasil dideteksi dari embed Discord), kita hitung ulang statusnya
// SETIAP KALI halaman dimuat/di-refresh — jadi begitu waktunya lewat,
// otomatis keliatan PAST di web tanpa perlu proses/cron terpisah yang
// nge-update kolom di database.
export function getEffectiveStatus(entry) {
  if (entry.category !== "RAFFLE") return entry.status;

  if (entry.status === "LIVE" && entry.expires_at) {
    const isExpired = new Date(entry.expires_at).getTime() <= Date.now();
    if (isExpired) return "PAST";
  }

  return entry.status;
}
