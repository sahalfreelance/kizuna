import { ethers } from "ethers";
import { supabase } from "./supabase.js";
import { decryptPrivateKey } from "./walletCrypto.js";
import { getOpenseaApiKey } from "./openseaKey.js";
import { getSiweSession, invalidateSiweSession } from "./siweSession.js";
import { checkWalletEligibility, summarizeStages } from "./eligibility.js";

/**
 * Pemroses job eligibility check.
 *
 * Dijalankan di loop worker yang sama dengan job mint, tapi diproses LEBIH
 * DULU dan lebih sering: pengecekan itu cepat (~2-4 detik) dan user sedang
 * menunggu di depan layar, sementara job mint biasanya menunggu jadwal.
 */

async function claimCheck(workerId) {
  const { data: candidates } = await supabase
    .from("aco_elig_checks")
    .select("id")
    .eq("status", "QUEUED")
    .order("created_at", { ascending: true })
    .limit(1);

  if (!candidates?.length) return null;

  // Guard status: dua worker tidak bisa mengambil check yang sama.
  const { data, error } = await supabase
    .from("aco_elig_checks")
    .update({
      status: "CLAIMED",
      claimed_by: workerId,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", candidates[0].id)
    .eq("status", "QUEUED")
    .select("*")
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

/**
 * Prewarm session SIWE untuk semua wallet user.
 *
 * Dipanggil SEBELUM pengecekan eligibility supaya login dua wallet terjadi
 * PARALEL, bukan berurutan. Login sequential 2 wallet = ~4-5 detik; paralel
 * = ~2 detik. Untuk checker yang ditunggu user di depan layar, itu selisih
 * yang terasa.
 *
 * Kenapa boleh paralel di sini padahal login mint sequential: yang membuat
 * opensea.io kena 429 adalah BANYAK wallet (5+). Dua wallet aman, dan
 * rateLimiter tetap memberi jeda otomatis kalau ternyata kena.
 */
async function prewarmSessions(wallets, apiKey, { log = null } = {}) {
  const t0 = Date.now();

  const settled = await Promise.allSettled(
    wallets.map((w) =>
      getSiweSession(
        {
          walletId: w.id,
          address: w.address,
          privateKey: w.privateKey,
          chainId: 1,
          apiKey,
        },
        { log }
      ).then((cookieStr) => ({ walletId: w.id, cookieStr }))
    )
  );

  const map = new Map();
  for (const r of settled) {
    if (r.status === "fulfilled") map.set(r.value.walletId, r.value.cookieStr);
  }

  console.log(
    `  [elig] session siap ${map.size}/${wallets.length} wallet dalam ${Date.now() - t0}ms`
  );
  return map;
}

export async function processEligibilityCheck(check, { workerId, log = null }) {
  const t0 = Date.now();
  const say = (msg) => console.log(`  [elig ${check.id.slice(0, 8)}] ${msg}`);

  try {
    // Ambil wallet: yang diminta, atau semua wallet user kalau kosong.
    let query = supabase
      .from("aco_wallets")
      .select("id, address, encrypted_key, label")
      .eq("user_id", check.user_id)
      .eq("is_active", true);

    if (check.wallet_ids?.length) {
      query = query.in("id", check.wallet_ids);
    }

    const { data: walletRows, error: walletError } = await query;
    if (walletError) throw new Error(`Gagal ambil wallet: ${walletError.message}`);
    if (!walletRows?.length) {
      throw new Error("Tidak ada wallet untuk dicek. Import wallet dulu.");
    }

    const apiKey = await getOpenseaApiKey(check.user_id);
    if (!apiKey) {
      throw new Error(
        "API key OpenSea tidak tersedia. Login ulang ke website supaya key dibuat."
      );
    }

    say(`cek ${walletRows.length} wallet terhadap "${check.slug}"`);

    // Dekripsi semua wallet dulu, sekalian validasi address.
    const wallets = [];
    const failed = [];

    for (const row of walletRows) {
      const label = row.label || `${row.address.slice(0, 6)}…${row.address.slice(-4)}`;
      try {
        const privateKey = decryptPrivateKey(row.encrypted_key);
        const derived = new ethers.Wallet(privateKey).address;

        if (derived.toLowerCase() !== row.address.toLowerCase()) {
          failed.push({
            walletId: row.id,
            address: row.address,
            label,
            ok: false,
            error: "Address tidak cocok dengan data tersimpan",
            stages: [],
          });
          continue;
        }

        wallets.push({ id: row.id, address: derived, privateKey, label });
      } catch (err) {
        failed.push({
          walletId: row.id,
          address: row.address,
          label,
          ok: false,
          error: String(err.message).slice(0, 250),
          stages: [],
        });
      }
    }

    // Login PARALEL — ini bagian paling lambat, jadi tidak boleh sequential.
    const sessionMap = await prewarmSessions(wallets, apiKey, { log });

    // Query eligibility juga PARALEL. Ini cuma 1 request per wallet dan
    // rateLimiter sudah menjaga lajunya.
    const settled = await Promise.allSettled(
      wallets.map(async (w) => {
        let cookieStr = sessionMap.get(w.id);
        if (!cookieStr) {
          // Login saat prewarm gagal — coba sekali lagi di sini.
          cookieStr = await getSiweSession(
            { walletId: w.id, address: w.address, privateKey: w.privateKey, chainId: 1, apiKey },
            { forceRelogin: true, log }
          );
        }

        let result;
        try {
          result = await checkWalletEligibility(cookieStr, w.address, check.slug);
        } catch (err) {
          // Session ditolak: buang cache, login ulang, coba SEKALI lagi.
          if (err.needsRelogin) {
            say(`session ${w.label} ditolak, login ulang`);
            await invalidateSiweSession(w.id);
            cookieStr = await getSiweSession(
              { walletId: w.id, address: w.address, privateKey: w.privateKey, chainId: 1, apiKey },
              { forceRelogin: true, log }
            );
            result = await checkWalletEligibility(cookieStr, w.address, check.slug);
          } else {
            throw err;
          }
        }

        return { wallet: w, result };
      })
    );

    const walletResults = [...failed];
    let collection = null;

    for (let i = 0; i < settled.length; i++) {
      const w = wallets[i];
      const s = settled[i];

      if (s.status === "rejected") {
        walletResults.push({
          walletId: w.id,
          address: w.address,
          label: w.label,
          ok: false,
          error: String(s.reason?.message ?? s.reason).slice(0, 250),
          stages: [],
        });
        say(`${w.label}: ERROR ${String(s.reason?.message ?? s.reason).slice(0, 120)}`);
        continue;
      }

      const { result } = s.value;
      if (result.collection) collection = result.collection;

      walletResults.push({
        walletId: w.id,
        address: w.address,
        label: w.label,
        ok: result.ok,
        error: result.error ?? null,
        stages: result.stages ?? [],
      });

      const eligCount = (result.stages ?? []).filter((x) => x.eligible === true).length;
      say(`${w.label}: ${result.ok ? `${eligCount} stage eligible` : result.error}`);
    }

    const stages = summarizeStages(walletResults);
    const anyOk = walletResults.some((w) => w.ok);

    await supabase
      .from("aco_elig_checks")
      .update({
        status: "DONE",
        result: {
          collection,
          wallets: walletResults,
          stages,
          totalWallets: walletResults.length,
          durationMs: Date.now() - t0,
        },
        // Kalau SEMUA wallet gagal, error pertama dinaikkan supaya UI bisa
        // menampilkan penyebabnya, bukan cuma "tidak ada hasil".
        error_message: anyOk ? null : walletResults[0]?.error ?? null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", check.id);

    say(`selesai dalam ${Date.now() - t0}ms · ${stages.length} stage`);
  } catch (err) {
    console.error(`  [elig ${check.id.slice(0, 8)}] gagal: ${err.message}`);
    await supabase
      .from("aco_elig_checks")
      .update({
        status: "FAILED",
        error_message: String(err.message).slice(0, 400),
        finished_at: new Date().toISOString(),
      })
      .eq("id", check.id);
  }
}

/**
 * Proses semua check yang mengantre. Dipanggil tiap tick loop worker,
 * SEBELUM job mint diperiksa.
 */
export async function drainEligibilityQueue({ workerId, log = null, max = 3 }) {
  let processed = 0;

  for (let i = 0; i < max; i++) {
    const check = await claimCheck(workerId);
    if (!check) break;
    await processEligibilityCheck(check, { workerId, log });
    processed++;
  }

  return processed;
}
