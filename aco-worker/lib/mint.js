import { ethers } from "ethers";
import fetch from "node-fetch";

const GQL_ENDPOINT = "https://gql.opensea.io/graphql";

const MINT_STATUS_QUERY = `
  query MintFlowStatusQuery(
    $transactionIdentifiers: [TransactionIdentifier!],
    $itemQuotes: [ItemQuoteInput!]!,
    $swapProvider: SwapProviderType!
  ) {
    buyReceipt(
      transactionIdentifiers: $transactionIdentifiers
      itemQuotes: $itemQuotes
      swapProvider: $swapProvider
      action: MINT
    ) {
      status
      itemReceipts {
        item {
          id
          imageUrl
          __typename
        }
        quantity
        __typename
      }
      failedItemReceipts {
        __typename
      }
      totalSpent {
        pricePerToken {
          token {
            symbol
            unit
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
  }
`;

// ─── Pre-fetch nonce (warm-up) ──────────────────────────────────────────────
export async function prefetchNonce(wallet) {
  try {
    const nonce = await wallet.getNonce("pending");
    console.log(`[Mint] Pre-fetched nonce for ${wallet.address}: ${nonce}`);
    return nonce;
  } catch (err) {
    console.log(`[Mint] ⚠️  Nonce pre-fetch failed: ${err.message}`);
    return null;
  }
}

// ─── Build & send tx dari OpenSea calldata ──────────────────────────────────
export async function sendMintTx(wallet, calldataResult, opts = {}) {
  const { cachedNonce = null, gasLimit = 300000 } = opts;

  // ─── DEBUG ─────────────────────────────────────────────────────────────
  console.log(`[DEBUG] sendMintTx input:`);
  console.log(`[DEBUG]   to    : ${calldataResult.to}`);
  console.log(`[DEBUG]   value : ${calldataResult.value}`);
  console.log(`[DEBUG]   data  : ${calldataResult.data?.slice(0, 20)}...`);
  // ────────────────────────────────────────────────────────────────────────

  const provider = wallet.provider;
  const nonce    = cachedNonce !== null ? cachedNonce : await wallet.getNonce("pending");
  const feeData  = await provider.getFeeData();

  // ─── DEBUG ─────────────────────────────────────────────────────────────
  console.log(`[DEBUG]   nonce          : ${nonce}`);
  console.log(`[DEBUG]   maxFeePerGas   : ${feeData.maxFeePerGas}`);
  console.log(`[DEBUG]   maxPriorityFee : ${feeData.maxPriorityFeePerGas}`);
  // ────────────────────────────────────────────────────────────────────────

  const value = BigInt(calldataResult.value || "0");

  const txRequest = {
    to:                   calldataResult.to,
    data:                 calldataResult.data,
    value,
    nonce,
    gasLimit,
    maxFeePerGas:         feeData.maxFeePerGas,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas,
    chainId:              (await provider.getNetwork()).chainId,
  };

  // ─── DEBUG ─────────────────────────────────────────────────────────────
  console.log(`[DEBUG]   txRequest built OK, submitting...`);
  // ────────────────────────────────────────────────────────────────────────

  try {
    const tx = await wallet.sendTransaction(txRequest);
    console.log(`[DEBUG]   tx hash : ${tx.hash}`);
    return tx;
  } catch (err) {
    console.log(`[DEBUG]   sendTransaction ERROR: ${err.message}`);
    throw err;
  }
}

// ─── Poll MintFlowStatusQuery sampai SUCCESS / FAILED ──────────────────────
export async function waitForMintStatus(txHash, contractAddress, chain, priceUnit, cookieStr, opts = {}) {
  const {
    pollIntervalMs = 2000,
    maxAttempts = 30,
  } = opts;

  const variables = {
    transactionIdentifiers: [{ chain, transactionHash: txHash }],
    itemQuotes: [{
      item: { chain, contractAddress, tokenId: "0" },
      pricePerItem: {
        contractAddress: "0x0000000000000000000000000000000000000000",
        unit: String(priceUnit),
      },
      quantity: 1,
    }],
    swapProvider: "LOCAL_MINT_NFT",
  };

  console.log(`[Mint] Polling MintFlowStatusQuery for tx: ${txHash}`);

  for (let i = 1; i <= maxAttempts; i++) {
    const res = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-app-id": "os2-web",
        "origin": "https://opensea.io",
        "referer": "https://opensea.io/",
        "cookie": cookieStr,
      },
      body: JSON.stringify({
        operationName: "MintFlowStatusQuery",
        query: MINT_STATUS_QUERY,
        variables,
      }),
    });

    const json = await res.json();
    const receipt = json.data?.buyReceipt;

    if (!receipt) {
      console.log(`[Mint] Attempt ${i}: no receipt yet, retrying...`);
      await new Promise(r => setTimeout(r, pollIntervalMs));
      continue;
    }

    console.log(`[Mint] Attempt ${i}: status = ${receipt.status}`);

    if (receipt.status === "SUCCESS") {
      const item = receipt.itemReceipts?.[0]?.item;
      const price = receipt.totalSpent?.pricePerToken?.[0]?.token;
      console.log(`[Mint] ✅ SUCCESS!`);
      if (item) console.log(`[Mint] Item ID : ${item.id}`);
      if (item) console.log(`[Mint] Image   : ${item.imageUrl}`);
      if (price) console.log(`[Mint] Price   : ${price.unit} ${price.symbol}`);
      return receipt;
    }

    if (receipt.status === "FAILED") {
      console.log(`[Mint] ❌ Mint FAILED according to OpenSea`);
      return receipt;
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`MintFlowStatusQuery: no SUCCESS after ${maxAttempts} attempts`);
}