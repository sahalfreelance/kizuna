import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";

const GQL_ENDPOINT = "https://gql.opensea.io/graphql";

// Query yang sama dengan graphql.js di worker — dijaga sinkron.
const DROP_QUERY = `
  query DropInfoQuery($slug: String!) {
    collectionBySlug(slug: $slug) {
      ... on Collection {
        address
        name
        chain { identifier }
        drop {
          stages {
            startTime
            endTime
            stageIndex
            stageType
            label
            maxTotalMintableByWallet
            price { token { unit symbol } }
          }
        }
      }
    }
  }
`;

/**
 * GET /api/aco/drop?slug=<slug>
 *
 * Ambil info drop + daftar stage dari OpenSea, supaya user bisa memilih stage
 * di UI sebelum bikin job.
 *
 * Kenapa lewat server, bukan fetch langsung dari browser? Karena
 * gql.opensea.io tidak mengizinkan CORS dari domain lain — request dari
 * browser akan diblokir. Jadi server yang jadi perantara.
 *
 * Endpoint ini TIDAK butuh cookie login OpenSea: query drop info bersifat
 * publik. Login SIWE per-wallet baru diperlukan saat mint, dan itu dikerjakan
 * worker di VPS.
 */
export async function GET(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const slug = String(searchParams.get("slug") || "").trim().toLowerCase();

  if (!slug) {
    return NextResponse.json({ error: "Slug wajib diisi." }, { status: 400 });
  }
  if (!/^[a-z0-9-]{2,120}$/.test(slug)) {
    return NextResponse.json(
      { error: "Slug tidak valid. Contoh yang benar: nama-collection-nya" },
      { status: 400 }
    );
  }

  let json;
  try {
    const res = await fetch(GQL_ENDPOINT, {
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
      body: JSON.stringify({ query: DROP_QUERY, variables: { slug } }),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `OpenSea membalas ${res.status}. Coba lagi sebentar.`, retryable: true },
        { status: 503 }
      );
    }
    json = await res.json();
  } catch (err) {
    console.error("[aco/drop] fetch gagal:", err?.message ?? err);
    return NextResponse.json(
      { error: "Tidak bisa menghubungi OpenSea. Coba lagi.", retryable: true },
      { status: 503 }
    );
  }

  if (json.errors) {
    return NextResponse.json(
      { error: "OpenSea menolak query. Slug mungkin salah." },
      { status: 400 }
    );
  }

  const collection = json.data?.collectionBySlug;
  if (!collection) {
    return NextResponse.json(
      { error: `Collection "${slug}" tidak ditemukan di OpenSea.` },
      { status: 404 }
    );
  }

  const stages = collection.drop?.stages || [];

  return NextResponse.json({
    data: {
      slug,
      name: collection.name || slug,
      contractAddress: collection.address || null,
      chain: collection.chain?.identifier || null,
      stages: stages.map((s) => ({
        stageIndex: s.stageIndex,
        label: s.label,
        stageType: s.stageType,
        startTime: s.startTime,
        endTime: s.endTime,
        maxTotalMintableByWallet: s.maxTotalMintableByWallet ?? 1,
        priceUnit: s.price?.token?.unit ?? "0",
        priceSymbol: s.price?.token?.symbol ?? "ETH",
      })),
    },
  });
}
