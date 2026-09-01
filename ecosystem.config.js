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

    // Dua worker, DIPISAH PER PLATFORM.
    //
    // Alasannya beban keduanya beda karakter:
    //
    //   OpenSea  — ratusan request HTTP ke satu host. Rentan rate limit, dan
    //              800 request melayang sudah terbukti membuat p50 melonjak
    //              780ms → 3641ms karena berebut satu event loop.
    //   Contract — eth_call ke RPC (sering RPC sendiri, batasnya jauh lebih
    //              longgar), tapi menghammer tanpa henti tiap 200ms sampai
    //              mint terbuka.
    //
    // Digabung, hammer contract yang jalan berjam-jam ikut memperlambat mint
    // OpenSea yang menang-kalahnya hitungan milidetik. Dipisah, keduanya punya
    // event loop sendiri.
    //
    // WAJIB: jalankan supabase/migration_worker_split.sql dulu, supaya klaim
    // job disaring per platform di sisi database. Tanpa itu kedua worker
    // berebut job yang bukan urusannya.
    {
      name: "kizuna-aco-worker",
      cwd: "./aco-worker",
      script: "worker.js",
      instances: 1,
      env: {
        WORKER_ID: "worker-opensea",
        WORKER_PLATFORMS: "opensea,mintbay,scatter",
      },
      autorestart: true,
      max_restarts: 20,
      max_memory_restart: "500M",
      time: true,
      restart_delay: 5000,
    },
    {
      name: "kizuna-aco-contract",
      cwd: "./aco-worker",
      script: "worker.js",
      instances: 1,
      env: {
        WORKER_ID: "worker-contract",
        WORKER_PLATFORMS: "contract",
        // Jauh lebih kecil dari OpenSea: mint by contract tidak menembak API
        // marketplace, jadi tidak perlu jatah 200. Yang dijaga di sini adalah
        // jumlah eth_call melayang ke RPC.
        MAX_CONCURRENT_MINTS: "50",
      },
      autorestart: true,
      max_restarts: 20,
      // Lebih kecil: tidak menyimpan session SIWE per wallet.
      max_memory_restart: "350M",
      time: true,
      restart_delay: 5000,
    },
  ],
};
