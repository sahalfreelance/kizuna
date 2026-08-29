import { ethers } from "ethers";
// PERUBAHAN dari versi CLI: fetch biasa diganti limitedFetch supaya request ke
// gql.opensea.io lewat token bucket dan menghormati Retry-After saat 429.
// Tanpa ini, hammer calldata (300x @200ms x jumlah wallet) memicu rate limit
// yang justru membuat semua wallet gagal.
import { limitedFetch as fetch } from "./rateLimiter.js";

const GQL_ENDPOINT = "https://gql.opensea.io/graphql";

const COMMON_HEADERS = {
  "content-type": "application/json",
  "x-app-id": "os2-web",
  "origin": "https://opensea.io",
  "referer": "https://opensea.io/",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
};

const DROP_QUERY = `
  query DropInfoQuery($slug: String!) {
    collectionBySlug(slug: $slug) {
      ... on Collection {
        address
        chain {
          identifier
        }
        drop {
          stages {
            startTime
            endTime
            stageIndex
            stageType
            label
            maxTotalMintableByWallet
            price {
              token {
                unit
                symbol
              }
            }
          }
        }
      }
    }
  }
`;

const buildSwapQuery = (wallets, contractAddress, chain, quantity = "1") => {
  for (let i = 0; i < wallets.length; i++) {
    const addr = typeof wallets[i] === "string" ? wallets[i] : wallets[i].address;
    if (!addr || addr === null || addr === undefined) {
      throw new Error(`[Config] Wallet index ${i} memiliki address null/undefined — cek config kamu!`);
    }
    if (!ethers.isAddress(addr)) {
      throw new Error(`[Config] Wallet index ${i} bukan alamat Ethereum valid: "${addr}"`);
    }
  }

  const fields = wallets.map((w, i) => {
    const addr = typeof w === "string" ? w : w.address;
    return `
    w${i}: swap(
      address: "${ethers.getAddress(addr)}"
      fromAssets: [{ asset: { chain: "${chain}", contractAddress: "0x0000000000000000000000000000000000000000" } }]
      toAssets: [{ asset: { chain: "${chain}", contractAddress: "${contractAddress}", tokenId: "0" }, quantity: "${quantity}" }]
      action: MINT
      capabilities: { eip7702: false }
    ) {
      actions {
        __typename
        ... on MintAction {
          transactionSubmissionData {
            to
            data
            value
          }
        }
      }
      errors {
        ... on TransactionError {
          message
        }
      }
    }`;
  }).join("\n");

  return `query B {\n${fields}\n}`;
};

export async function fetchDropInfo(slug, cookieStr) {
  const res = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers: { ...COMMON_HEADERS, cookie: cookieStr },
    body: JSON.stringify({
      query: DROP_QUERY,
      variables: { slug },
    }),
  });

  if (!res.ok) throw new Error(`fetchDropInfo failed: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);

  const collection      = json.data.collectionBySlug;
  const contractAddress = collection?.address;
  const chainIdentifier = collection?.chain?.identifier;
  const stages          = collection?.drop?.stages || [];

  console.log(`[GQL] contractAddress: ${contractAddress}, chain: ${chainIdentifier}`);
  console.log(`[GQL] Stages found: ${stages.length}`);
  stages.forEach(s => console.log(`  - ${s.stageType} | ${s.label} | starts: ${s.startTime}`));

  return { contractAddress, chain: chainIdentifier, stages };
}

export async function fetchCalldata(wallets, contractAddress, chain, cookieStr, quantity = "1") {
  const normalizedWallets = wallets.map(w =>
    typeof w === "string"
      ? { address: w, cookieStr }
      : { address: w.address, cookieStr: w.cookieStr || cookieStr }
  );

  if (!normalizedWallets.length) {
    throw new Error("[Config] Daftar wallet kosong!");
  }

  const query = buildSwapQuery(normalizedWallets, contractAddress, chain, quantity);

  const firstWallet = normalizedWallets[0];
  const res = await fetch(GQL_ENDPOINT, {
    method: "POST",
    headers: {
      ...COMMON_HEADERS,
      cookie: firstWallet.cookieStr,
      "connected-account-server-hint": ethers.getAddress(firstWallet.address),
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) throw new Error(`fetchCalldata failed: ${res.status} ${await res.text()}`);
  const json = await res.json();

  const results = [];

  for (let i = 0; i < normalizedWallets.length; i++) {
    const alias         = `w${i}`;
    const walletAddress = normalizedWallets[i].address;
    const walletData    = json.data?.[alias];

    if (!walletData) {
      console.log(`[DEBUG] w${i} (${walletAddress.slice(0, 8)}...) → No data returned`);
      results.push({ address: walletAddress, success: false, error: "No data returned" });
      continue;
    }

    if (walletData.errors?.length > 0) {
      const errMsg     = walletData.errors[0]?.message || "Unknown error";
      const isTransient =
        errMsg.includes("DropNotMinting") ||
        errMsg.includes("not live") ||
        errMsg.includes("not eligible");

      console.log(`[DEBUG] w${i} (${walletAddress.slice(0, 8)}...) → Error: ${errMsg} | transient: ${isTransient}`);
      results.push({ address: walletAddress, success: false, error: errMsg, retry: isTransient });
      continue;
    }

    const mintAction = walletData.actions?.find((a) => a.__typename === "MintAction");
    const txData     = mintAction?.transactionSubmissionData;

    if (!txData?.data) {
      const allTypes = walletData.actions?.map(a => a.__typename).join(", ") || "none";
      console.log(`[DEBUG] w${i} (${walletAddress.slice(0, 8)}...) → No calldata | action types: [${allTypes}]`);
      results.push({ address: walletAddress, success: false, error: "No calldata in response" });
      continue;
    }

    console.log(`[DEBUG] w${i} (${walletAddress.slice(0, 8)}...) → ✅ Calldata OK | to: ${txData.to} | value: ${txData.value}`);
    results.push({
      address: walletAddress,
      success: true,
      to:      txData.to,
      data:    txData.data,
      value:   txData.value || "0",
    });
  }

  return results;
}

export async function fetchCalldataWithRetry(wallets, contractAddress, chain, cookieStr, opts = {}) {
  const {
    startTime,
    maxRetries   = 30,
    retryDelayMs = 200,
    quantity     = "1",
  } = opts;

  if (!wallets || wallets.length === 0) {
    throw new Error("[Config] Tidak ada wallet yang diberikan ke fetchCalldataWithRetry!");
  }
  if (!contractAddress) {
    throw new Error("[Config] contractAddress null/undefined — cek fetchDropInfo atau config kamu!");
  }
  if (!chain) {
    throw new Error("[Config] chain null/undefined — cek fetchDropInfo atau config kamu!");
  }

  if (startTime) {
    const now       = Math.floor(Date.now() / 1000);
    const waitUntil = startTime - 1.5;
    if (now < waitUntil) {
      const waitMs = (waitUntil - now) * 1000;
      console.log(`[GQL] Waiting ${(waitMs / 1000).toFixed(1)}s before hammering...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  console.log(`[GQL] Starting swap() retry loop...`);

  const hardErrorAddresses = new Set();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const activeWallets = wallets.filter(w => {
        const addr = typeof w === "string" ? w : w.address;
        return !hardErrorAddresses.has(addr);
      });

      if (activeWallets.length === 0) {
        throw new Error("Semua wallet sudah hard error, aborting.");
      }

      const results = await fetchCalldata(activeWallets, contractAddress, chain, cookieStr, quantity);

      const successful      = results.filter((r) => r.success);
      const transientErrors = results.filter((r) => !r.success && r.retry);
      const hardErrors      = results.filter((r) => !r.success && !r.retry);

      for (const e of hardErrors) {
        console.log(`[GQL] ❌ ${e.address}: ${e.error} (skipping permanently)`);
        hardErrorAddresses.add(e.address);
      }

      if (successful.length > 0) {
        console.log(`[GQL] ✅ Got calldata on attempt ${attempt}`);
        return successful;
      }

      if (transientErrors.length > 0) {
        if (attempt % 10 === 0) {
          console.log(`[GQL] Attempt ${attempt}/${maxRetries} — mint not live yet...`);
        }
        await new Promise((r) => setTimeout(r, retryDelayMs));
        continue;
      }

      throw new Error("Semua wallet memiliki hard error, aborting.");

    } catch (err) {
      if (
        err.code === "INVALID_ARGUMENT" ||
        err.code === "MISSING_ARGUMENT" ||
        err.message.startsWith("[Config]")
      ) {
        console.error(`[GQL] ❌ Config error, tidak akan di-retry: ${err.message}`);
        throw err;
      }

      if (attempt === maxRetries) throw err;
      console.log(`[GQL] Attempt ${attempt} threw: ${err.message}, retrying...`);
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }

  throw new Error(`Failed to get calldata after ${maxRetries} attempts`);
}