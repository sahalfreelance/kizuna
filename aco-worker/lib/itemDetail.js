import { limitedFetch as fetch } from "./rateLimiter.js";

/**
 * Ambil detail item NFT (nama, gambar) setelah mint terkonfirmasi.
 *
 * Ini murni pelengkap tampilan. Kegagalan di sini TIDAK boleh mengubah status
 * mint — status sudah ditentukan dari chain (lihat confirmChain.js). Kalau
 * OpenSea kena rate limit, hasilnya cuma "gambar tidak ada", bukan "mint gagal".
 *
 * Dua sumber, dicoba berurutan:
 *   1. api.opensea.io/api/v2 — resmi, butuh API key (kita sudah punya per user)
 *   2. gql.opensea.io — cadangan, dipakai kalau v2 belum mengindeks
 *
 * Token yang baru di-mint kadang belum terindeks. Itu diperlakukan sebagai
 * "belum ada gambar", bukan error.
 */

const V2_BASE = "https://api.opensea.io/api/v2";

function baseHeaders(apiKey) {
  return {
    accept: "application/json",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ...(apiKey ? { "x-api-key": apiKey } : {}),
  };
}

/**
 * GET /chain/{chain}/contract/{address}/nfts/{identifier}
 */
async function fetchFromV2(chain, contractAddress, tokenId, apiKey) {
  const url = `${V2_BASE}/chain/${encodeURIComponent(chain)}/contract/${contractAddress}/nfts/${encodeURIComponent(tokenId)}`;

  const res = await fetch(url, { headers: baseHeaders(apiKey) });
  if (!res.ok) {
    // 404 = belum terindeks. Bukan error, cuma belum ada.
    if (res.status === 404) return null;
    throw new Error(`OpenSea v2 ${res.status}`);
  }

  const json = await res.json();
  const nft = json?.nft;
  if (!nft) return null;

  return {
    tokenId: String(nft.identifier ?? tokenId),
    name: nft.name || null,
    imageUrl: nft.display_image_url || nft.image_url || null,
    animationUrl: nft.animation_url || null,
    openseaUrl: nft.opensea_url || null,
    collection: nft.collection || null,
    standard: nft.token_standard || null,
  };
}

/**
 * Cadangan lewat GraphQL publik. Tidak butuh API key, tapi bentuk datanya
 * tidak dijamin stabil — jadi dipakai hanya kalau v2 tidak memberi hasil.
 */
async function fetchFromGql(chain, contractAddress, tokenId) {
  const query = `
    query ItemDetail($chain: ChainIdentifier!, $address: Address!, $tokenId: String!) {
      item(chain: $chain, address: $address, tokenId: $tokenId) {
        name
        tokenId
        imageUrl
        collection { name slug }
      }
    }`;

  const res = await fetch("https://gql.opensea.io/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-app-id": "os2-web",
      origin: "https://opensea.io",
      referer: "https://opensea.io/",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({
      operationName: "ItemDetail",
      query,
      variables: { chain, address: contractAddress, tokenId: String(tokenId) },
    }),
  });

  if (!res.ok) throw new Error(`gql ${res.status}`);

  const json = await res.json();
  if (json.errors?.length) return null;

  const item = json.data?.item;
  if (!item) return null;

  return {
    tokenId: String(item.tokenId ?? tokenId),
    name: item.name || null,
    imageUrl: item.imageUrl || null,
    animationUrl: null,
    openseaUrl: item.collection?.slug
      ? `https://opensea.io/assets/${chain}/${contractAddress}/${tokenId}`
      : null,
    collection: item.collection?.name || null,
    standard: null,
  };
}

/**
 * Ambil detail untuk beberapa token sekaligus.
 *
 * Selalu mengembalikan array selengkap input — token yang gagal diambil tetap
 * ada entri-nya (dengan `imageUrl: null`), supaya UI bisa menampilkan token id
 * dan link explorer walau gambarnya belum tersedia.
 */
export async function fetchMintedItems(tokens, chain, apiKey, { log = null } = {}) {
  if (!tokens?.length) return [];

  const results = await Promise.allSettled(
    tokens.slice(0, 20).map(async (t) => {
      const contract = t.contract;

      try {
        const v2 = await fetchFromV2(chain, contract, t.tokenId, apiKey);
        if (v2) return { ...t, ...v2, source: "v2" };
      } catch (err) {
        await log?.warn?.(`Detail item v2 gagal: ${String(err.message).slice(0, 80)}`);
      }

      try {
        const gql = await fetchFromGql(chain, contract, t.tokenId);
        if (gql) return { ...t, ...gql, source: "gql" };
      } catch {
        /* cadangan gagal juga — lanjut ke fallback minimal */
      }

      // Fallback: token id tetap berguna walau tanpa gambar.
      return {
        ...t,
        name: null,
        imageUrl: null,
        openseaUrl: `https://opensea.io/assets/${chain}/${contract}/${t.tokenId}`,
        source: "none",
      };
    })
  );

  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { ...tokens[i], name: null, imageUrl: null, source: "none" }
  );
}
