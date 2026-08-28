import { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabase";
import { encryptPrivateKey, normalizePrivateKey } from "@/lib/walletCrypto";

const MAX_WALLETS_PER_USER = 20;

/**
 * GET /api/aco/wallets
 *
 * Daftar wallet milik user. `encrypted_key` SENGAJA tidak di-select —
 * private key tidak boleh pernah keluar ke browser dalam bentuk apa pun.
 */
export async function GET(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from("aco_wallets")
    .select("id, label, address, is_active, created_at")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[aco/wallets] GET gagal:", error.message);
    return NextResponse.json({ error: "Gagal ambil daftar wallet." }, { status: 500 });
  }

  return NextResponse.json({ data });
}

/**
 * POST /api/aco/wallets
 * body: { private_key, label? }
 *
 * Address diturunkan dari private key-nya, bukan diambil dari input user —
 * biar tidak mungkin ada wallet yang address dan key-nya tidak cocok.
 */
export async function POST(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const privateKey = normalizePrivateKey(body?.private_key);
  const label = body?.label ? String(body.label).slice(0, 60) : null;

  if (!privateKey) {
    return NextResponse.json(
      { error: "Private key tidak valid. Harus 64 karakter hex (boleh dengan atau tanpa 0x)." },
      { status: 400 }
    );
  }

  let address;
  try {
    address = new ethers.Wallet(privateKey).address;
  } catch {
    return NextResponse.json(
      { error: "Private key tidak bisa dipakai untuk membuat wallet." },
      { status: 400 }
    );
  }

  // Batas jumlah wallet: menahan penyalahgunaan dan menjaga durasi mint tetap
  // masuk akal (tiap wallet perlu login SIWE sendiri).
  const { count, error: countError } = await supabaseAdmin
    .from("aco_wallets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.userId);

  if (countError) {
    console.error("[aco/wallets] count gagal:", countError.message);
    return NextResponse.json({ error: "Gagal cek jumlah wallet." }, { status: 500 });
  }

  if ((count ?? 0) >= MAX_WALLETS_PER_USER) {
    return NextResponse.json(
      { error: `Maksimal ${MAX_WALLETS_PER_USER} wallet per akun.` },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from("aco_wallets")
    .insert({
      user_id: auth.userId,
      label,
      address,
      encrypted_key: encryptPrivateKey(privateKey),
    })
    .select("id, label, address, is_active, created_at")
    .single();

  if (error) {
    // 23505 = unique violation (user_id, address)
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "Wallet dengan address ini sudah pernah diimpor." },
        { status: 409 }
      );
    }
    // Pesan error dari lapisan enkripsi bisa menyebut env yang belum di-set —
    // itu informasi operasional, jadi dicatat di log server saja.
    console.error("[aco/wallets] insert gagal:", error.message);
    return NextResponse.json({ error: "Gagal simpan wallet." }, { status: 500 });
  }

  return NextResponse.json({ data });
}
