import { NextResponse } from "next/server";
import { getAuthContext, buildDenial } from "@/lib/apiAuth";
import { supabaseAdmin } from "@/lib/supabase";
import { encryptPrivateKey } from "@/lib/walletCrypto";

/**
 * API key OpenSea milik masing-masing user.
 *
 * DUA ALASAN key dibuat per user, bukan satu key bersama:
 *
 *   1. Pembuatan key dibatasi 2/hari PER IP (terverifikasi: endpoint
 *      /api/v2/auth/keys balas 429 "Maximum 2 keys per day"). Kalau server
 *      yang meminta, semua user berbagi kuota IP server dan cepat habis.
 *      Karena itu key diminta dari BROWSER USER — kuota terpakai dari IP
 *      masing-masing user. Endpoint OpenSea mengizinkan CORS dari origin mana
 *      pun, jadi fetch dari browser memang bisa.
 *
 *   2. Pemakaian key juga punya rate limit sendiri. Satu key dipakai bersama
 *      berarti saat beberapa user mint bersamaan, request saling berebut kuota
 *      dan sebagian gagal. Satu key per user menghilangkan bentrok itu.
 *
 * Endpoint di file ini TIDAK memanggil OpenSea. Browser yang memanggil, lalu
 * mengirim hasilnya ke sini untuk disimpan terenkripsi.
 */

const ASSUMED_LIFETIME_DAYS = 30;
// Key berlaku 30 hari; diperbarui di hari ke-21 supaya selalu ada sisa ~9 hari
// sebagai bantalan kalau pembaruan gagal.
const REFRESH_AFTER_DAYS = 21;

function daysBetween(a, b) {
  return (b.getTime() - a.getTime()) / 86400000;
}

/**
 * GET /api/aco/user-key
 *
 * Status key user + apakah perlu diperbarui. Key-nya sendiri TIDAK dikirim.
 * Browser memakai `needsRefresh` untuk memutuskan apakah harus memanggil
 * OpenSea setelah login.
 */
export async function GET(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { data, error } = await supabaseAdmin
    .from("aco_user_keys")
    .select("key_hint, expires_at, last_used_at, created_at, updated_at")
    .eq("user_id", auth.userId)
    .maybeSingle();

  if (error) {
    console.error("[aco/user-key] GET gagal:", error.message);
    return NextResponse.json({ error: "Gagal ambil status key." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({
      data: { present: false, needsRefresh: true, reason: "belum punya key" },
    });
  }

  const now = new Date();
  const issuedAt = new Date(data.updated_at || data.created_at);
  const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
  const ageDays = daysBetween(issuedAt, now);
  const expired = expiresAt ? expiresAt <= now : false;
  const needsRefresh = expired || ageDays >= REFRESH_AFTER_DAYS;

  return NextResponse.json({
    data: {
      present: true,
      hint: data.key_hint,
      ageDays: Number(ageDays.toFixed(1)),
      expiresAt: expiresAt?.toISOString() ?? null,
      daysLeft: expiresAt ? Number(daysBetween(now, expiresAt).toFixed(1)) : null,
      expired,
      needsRefresh,
      reason: expired
        ? "key kedaluwarsa"
        : needsRefresh
        ? `umur key ${ageDays.toFixed(0)} hari`
        : "key masih segar",
      lastUsedAt: data.last_used_at,
    },
  });
}

/**
 * POST /api/aco/user-key
 * body: { api_key, expires_at? }
 *
 * Simpan key yang baru diambil browser dari OpenSea. Upsert — satu key per
 * user, jadi refresh menimpa yang lama alih-alih menumpuk key mati.
 */
export async function POST(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const body = await req.json().catch(() => null);
  const apiKey = String(body?.api_key || "").trim();

  // Batas panjang yang wajar supaya tidak ada payload aneh masuk ke DB.
  if (!apiKey || apiKey.length < 8 || apiKey.length > 200) {
    return NextResponse.json(
      { error: "API key tidak valid." },
      { status: 400 }
    );
  }

  let expiresAt;
  if (body?.expires_at) {
    const parsed = new Date(body.expires_at);
    expiresAt = Number.isNaN(parsed.getTime())
      ? new Date(Date.now() + ASSUMED_LIFETIME_DAYS * 86400000)
      : parsed;
  } else {
    expiresAt = new Date(Date.now() + ASSUMED_LIFETIME_DAYS * 86400000);
  }

  const { data, error } = await supabaseAdmin
    .from("aco_user_keys")
    .upsert(
      {
        user_id: auth.userId,
        encrypted_key: encryptPrivateKey(apiKey),
        key_hint: apiKey.slice(-4),
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("key_hint, expires_at, updated_at")
    .single();

  if (error) {
    console.error("[aco/user-key] upsert gagal:", error.message);
    return NextResponse.json({ error: "Gagal simpan API key." }, { status: 500 });
  }

  return NextResponse.json({ data });
}

/**
 * DELETE /api/aco/user-key
 *
 * Hapus key user. Job berikutnya akan jatuh ke key bersama (kalau ada), atau
 * gagal dengan pesan yang meminta user memperbarui key-nya.
 */
export async function DELETE(req) {
  const auth = await getAuthContext(req);
  const denied = buildDenial(auth, NextResponse);
  if (denied) return denied;

  const { error } = await supabaseAdmin
    .from("aco_user_keys")
    .delete()
    .eq("user_id", auth.userId);

  if (error) {
    console.error("[aco/user-key] DELETE gagal:", error.message);
    return NextResponse.json({ error: "Gagal hapus API key." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
