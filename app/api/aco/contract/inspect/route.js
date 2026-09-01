import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabase";
import { decryptPrivateKey } from "@/lib/walletCrypto";
import { getChain, isSupportedChain } from "@/lib/chains";
import { fetchAbi } from "@/lib/abiFetch";
import {
  findMintFunctions,
  readContractState,
  detectMintMode,
  priceFromState,
} from "@/lib/contractMint";

/**
 * POST /api/aco/contract/inspect
 *
 * Body: { address, chain }
 *
 * Ambil ABI otomatis, tentukan fungsi mint, dan baca state on-chain supaya UI
 * bisa langsung menampilkan mode (FCFS / WHITELIST), harga, dan supply tanpa
 * user menempel ABI apa pun.
 *
 * Tidak menyentuh private key dan tidak mengirim transaksi — ini murni baca.
 */
export async function POST(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON." }, { status: 400 });
  }

  const address = String(body.address || "").trim();
  const chainId = String(body.chain || "").trim();

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "Alamat kontrak tidak valid." }, { status: 400 });
  }
  if (!isSupportedChain(chainId)) {
    return NextResponse.json({ error: `Chain tidak didukung: ${chainId}` }, { status: 400 });
  }

  const chain = getChain(chainId);
  const rpcUrl = await resolveRpc(auth.userId, chainId, chain.defaultRpc);

  try {
    const info = await fetchAbi(address, chainId, {
      rpcUrl,
      etherscanKey: process.env.ETHERSCAN_API_KEY || null,
    });

    const mintFunctions = findMintFunctions(info.abi);
    const state = await readContractState(address, info.abi, rpcUrl);
    const mode = detectMintMode(info.abi, state, mintFunctions);

    return NextResponse.json({
      address,
      chain: chainId,
      abiSource: info.source,
      verified: info.verified,
      proxyOf: info.proxyOf,
      selectorsNamed: info.selectorsNamed ?? null,
      selectorsTotal: info.selectorsTotal ?? null,
      // ABI penuh tidak dikirim: bisa ratusan KB dan UI tidak butuh. Yang
      // dipakai UI hanya daftar fungsi mint.
      abiEntries: info.abi.length,
      mintFunctions: mintFunctions.map((f) => ({
        signature: f.signature,
        name: f.name,
        inputs: f.inputs,
        payable: f.payable,
        needsProof: f.needsProof,
        ownerOnly: f.ownerOnly,
        score: f.score,
      })),
      state,
      mode,
      priceWei: priceFromState(state),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

/** RPC milik user kalau ada; kalau tidak, RPC publik default chain. */
async function resolveRpc(userId, chainId, fallback) {
  const { data } = await supabaseAdmin
    .from("aco_rpcs")
    .select("encrypted_url")
    .eq("user_id", userId)
    .eq("chain", chainId)
    .maybeSingle();

  if (!data?.encrypted_url) return fallback;
  try {
    return decryptPrivateKey(data.encrypted_url);
  } catch {
    // RPC tersimpan tapi tidak bisa didekripsi (kunci berubah): jangan gagalkan
    // permintaan, pakai publik saja.
    return fallback;
  }
}
