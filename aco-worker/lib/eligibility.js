import { ethers } from "ethers";
import { limitedFetch as fetch } from "./rateLimiter.js";

/**
 * Eligibility checker OpenSea drops.
 *
 * Diadaptasi dari pdonir/nft-mint-check-pipeline
 * (scripts/checker/opensea_checker/opensea_checker_api.py) — pendekatan
 * intinya sama: SIWE login lalu tanya field eligibility ke gql.opensea.io.
 *
 * TEMUAN yang menentukan bentuk kode ini (diverifikasi langsung):
 *
 *   tanpa auth  -> UNAUTHORIZED @ stages.isEligible
 *                  UNAUTHORIZED @ stages.eligibleMaxTotalMintableByWallet
 *                  UNAUTHORIZED @ stages.eligiblePrice
 *   dengan SIWE -> tidak ada error, field terbuka
 *
 * Jadi checker WAJIB punya cookie session hasil SIWE. Itu sebabnya ia jalan di
 * worker (tempat private key didekripsi), bukan di browser user.
 *
 * Perbedaan dari repo aslinya: query dipasang di `collectionBySlug` alih-alih
 * `dropBySlug`. Alasannya `collectionBySlug` sudah terbukti jalan di worker ini
 * (dipakai fetchDropInfo) dan sekaligus memberi contract address + chain, jadi
 * satu request cukup untuk checker maupun persiapan job.
 */

const GQL = "https://gql.opensea.io/graphql";

const ELIG_QUERY = `
query DropEligibility($slug: String!) {
  collectionBySlug(slug: $slug) {
    ... on Collection {
      name
      address
      chain { identifier }
      drop {
        __typename
        stages {
          stageIndex
          label
          stageType
          startTime
          endTime
          maxTotalMintableByWallet
          eligibleMaxTotalMintableByWallet
          isEligible
          price { token { unit symbol } }
          eligiblePrice { token { unit symbol } }
        }
      }
    }
  }
}`;

/**
 * Header auth per wallet.
 *
 * Cookie saja tidak cukup — repo aslinya menemukan gql.opensea.io butuh
 * konteks "wallet aktif" lewat header x-*-address dan menerima JWT di
 * x-auth-token. Itu dipertahankan di sini karena terbukti perlu.
 */
function authHeaders(cookieStr, address) {
  const accessToken = cookieStr.match(/access_token=([^;]+)/)?.[1] ?? "";
  const lower = address.toLowerCase();

  return {
    "content-type": "application/json",
    "x-app-id": "os2-web",
    origin: "https://opensea.io",
    referer: "https://opensea.io/",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    cookie: `${cookieStr}; connected-account-server-hint=${address}`,
    ...(accessToken ? { "x-auth-token": accessToken } : {}),
    "x-active-address": lower,
    "x-wallet-address": lower,
    "x-active-wallet-address": lower,
    "x-user-address": lower,
  };
}

/**
 * Tentukan eligible atau tidak untuk satu stage.
 *
 * Urutan pemeriksaan diambil dari repo aslinya, karena OpenSea tidak selalu
 * mengisi `isEligible`:
 *   1. isEligible kalau ada -> paling tegas
 *   2. eligibleMaxTotalMintableByWallet > 0 -> ada kuota untuk wallet ini
 *   3. stage publik -> tidak butuh allowlist, cukup limit global > 0
 *   4. sisanya -> anggap tidak eligible
 *
 * Balikan `null` berarti TIDAK DIKETAHUI (bukan "tidak eligible"). Ini penting:
 * menampilkan "NOT ELIGIBLE" padahal datanya tidak terbaca akan membuat user
 * membatalkan mint yang sebenarnya bisa.
 */
export function decideEligible(stage) {
  if (stage.isEligible !== null && stage.isEligible !== undefined) {
    return Boolean(stage.isEligible);
  }

  const eligMax = stage.eligibleMaxTotalMintableByWallet;
  if (eligMax !== null && eligMax !== undefined) {
    const n = Number(eligMax);
    if (Number.isFinite(n)) return n > 0;
  }

  // Stage publik biasanya tidak perlu allowlist.
  const label = String(stage.label || "").toLowerCase();
  const type = String(stage.stageType || "").toLowerCase();
  if (label.includes("public") || type.includes("public")) {
    return Number(stage.maxTotalMintableByWallet || 0) > 0;
  }

  return null; // tidak diketahui
}

export function stageLimit(stage) {
  return (
    stage.eligibleMaxTotalMintableByWallet ??
    stage.maxTotalMintableByWallet ??
    null
  );
}

/**
 * Cek satu wallet terhadap satu slug.
 * @returns { ok, stages, collection, error }
 */
export async function checkWalletEligibility(cookieStr, address, slug) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: authHeaders(cookieStr, address),
    body: JSON.stringify({
      operationName: "DropEligibility",
      query: ELIG_QUERY,
      variables: { slug },
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GraphQL ${res.status}: ${text.slice(0, 160)}`);
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Respons OpenSea bukan JSON");
  }

  // Error UNAUTHORIZED pada field eligibility = session tidak dipakai/kadaluarsa.
  // Ini dibedakan dari error lain supaya pemanggil bisa login ulang.
  if (json.errors?.length) {
    const unauthorized = json.errors.some(
      (e) => e.extensions?.code === "UNAUTHORIZED"
    );
    if (unauthorized) {
      const err = new Error(
        "Field eligibility ditolak OpenSea (session tidak valid)"
      );
      err.needsRelogin = true;
      throw err;
    }
    throw new Error(json.errors.map((e) => e.message).join("; ").slice(0, 200));
  }

  const collection = json.data?.collectionBySlug;
  if (!collection) {
    return { ok: false, error: `Collection "${slug}" tidak ditemukan`, stages: [] };
  }

  const drop = collection.drop;
  if (!drop || !drop.stages?.length) {
    return {
      ok: false,
      error: "Collection ini tidak punya drop aktif (mint sudah selesai atau belum dibuat)",
      collection: {
        name: collection.name,
        contractAddress: collection.address,
        chain: collection.chain?.identifier ?? null,
      },
      stages: [],
    };
  }

  const stages = [...drop.stages]
    .sort((a, b) => String(a.startTime ?? "").localeCompare(String(b.startTime ?? "")))
    .map((s) => ({
      stageIndex: s.stageIndex,
      label: s.label ?? `Stage ${s.stageIndex}`,
      stageType: s.stageType ?? null,
      startTime: s.startTime ?? null,
      endTime: s.endTime ?? null,
      eligible: decideEligible(s),
      maxMintable: stageLimit(s),
      priceUnit: (s.eligiblePrice ?? s.price)?.token?.unit ?? null,
      priceSymbol: (s.eligiblePrice ?? s.price)?.token?.symbol ?? null,
    }));

  return {
    ok: true,
    collection: {
      name: collection.name,
      contractAddress: collection.address,
      chain: collection.chain?.identifier ?? null,
    },
    stages,
  };
}

/**
 * Gabungkan hasil beberapa wallet jadi ringkasan per stage.
 *
 * Ini yang dipakai UI untuk label `ELIGIBLE 2/2`. Wallet yang GAGAL dicek
 * tidak dihitung sebagai "tidak eligible" — dipisah ke `unknownCount`, supaya
 * error jaringan tidak tampil sebagai "NOT ELIGIBLE" yang menyesatkan.
 */
export function summarizeStages(walletResults) {
  const byIndex = new Map();

  for (const w of walletResults) {
    if (!w.ok) continue;
    for (const s of w.stages) {
      if (!byIndex.has(s.stageIndex)) {
        byIndex.set(s.stageIndex, {
          stageIndex: s.stageIndex,
          label: s.label,
          stageType: s.stageType,
          startTime: s.startTime,
          endTime: s.endTime,
          eligibleCount: 0,
          notEligibleCount: 0,
          unknownCount: 0,
          checkedWallets: 0,
          eligibleWallets: [],
        });
      }
      const agg = byIndex.get(s.stageIndex);
      agg.checkedWallets++;
      if (s.eligible === true) {
        agg.eligibleCount++;
        agg.eligibleWallets.push(w.label || w.address);
      } else if (s.eligible === false) {
        agg.notEligibleCount++;
      } else {
        agg.unknownCount++;
      }
    }
  }

  return [...byIndex.values()].sort(
    (a, b) => String(a.startTime ?? "").localeCompare(String(b.startTime ?? ""))
  );
}
