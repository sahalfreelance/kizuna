// Konfigurasi pm2 untuk semua proses Kizuna di VPS.
//
// Pakai:
//   pm2 start ecosystem.config.js          # jalanin semua
//   pm2 start ecosystem.config.js --only kizuna-aco-worker
//   pm2 save                               # ingat daftar proses
//   pm2 startup                            # auto-start saat VPS reboot
//
// Catatan: tiap proses baca .env-nya sendiri lewat dotenv (bot/.env dan
// aco-worker/.env), jadi tidak ada secret di file ini.

module.exports = {
  apps: [
    {
      name: "garapan-bot",
      cwd: "./bot",
      script: "garapan-bot.js",
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      // Bot idle-nya ringan; kalau memakai lebih dari ini berarti ada
      // kebocoran memori dan lebih baik direstart.
      max_memory_restart: "300M",
      time: true,
    },
    {
      name: "kizuna-aco-worker",
      cwd: "./aco-worker",
      script: "worker.js",
      instances: 1,
      // JANGAN dinaikkan jadi >1 tanpa memikirkan ulang: dua worker akan
      // saling berebut job. Claim-nya sudah atomic jadi tidak akan dobel
      // eksekusi, tapi mint paralel dari satu VPS justru saling melambatkan.
      autorestart: true,
      max_restarts: 20,
      max_memory_restart: "500M",
      time: true,
      // Jeda restart supaya kalau ada error beruntun tidak membanjiri log.
      restart_delay: 5000,
    },
  ],
};
