import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { decryptPrivateKey } from "@/lib/walletCrypto";
import { getOpenseaApiKey } from "@/lib/openseaKey";

/**
 * GET /api/internal/opensea-key?user_id=<uuid>
 * header: x-worker-secret: <WORKER_SHARED_SECRET>
 *
 * Dipakai worker VPS untuk mengambil API key OpenSea.
 *
 * `user_id` wajib: tiap user punya key sendiri, supaya pemakaian bersamaan
 * tidak saling berebut rate limit. Kalau user belum punya key, endpoint ini
 * jatuh ke key bersama (tabel opensea_api_keys) supaya job tidak langsung
 * gagal — dan responsnya menandai `source` supaya kelihatan di log worker.
 *
 * Autentikasi memakai shared secret, bukan sesi user: worker bukan user.
 * Kalau WORKER_SHARED_SECRET tidak di-set, endpoint menolak semua request
 * (503) — gagal tertutup, bukan terbuka.
 */
export async function GET(req) {
  const expected = process.env.WORKER_SHARED_SECRET;

  if (!expected) {
    console.error("[internal/opensea-key] WORKER_SHARED_SECRET belum di-set");
    return NextResponse.json({ error: "Endpoint belum dikonfigurasi." }, { status: 503 });
  }

  const provided = req.headers.get("x-worker-secret") || "";
  if (provided.length !== expected.length || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("user_id");

  try {
    // 1. Key milik user itu sendiri.
    if (userId) {
      const { data, error } = await supabaseAdmin
        .from("aco_user_keys")
        .select("id, encrypted_key, key_hint, expires_at")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        console.error("[internal/opensea-key] query gagal:", error.message);
      } else if (data) {
        const expired = data.expires_at && new Date(data.expires_at) <= new Date();

        if (!expired) {
          // Catat pemakaian; kegagalan update ini tidak penting.
          supabaseAdmin
            .from("aco_user_keys")
            .update({ last_used_at: new Date().toISOString() })
            .eq("id", data.id)
            .then(() => {}, () => {});

          return NextResponse.json({
            api_key: decryptPrivateKey(data.encrypted_key),
            source: "user",
            hint: data.key_hint,
            expires_at: data.expires_at,
          });
        }
      }
    }

    // 2. Cadangan: key bersama.
    const shared = await getOpenseaApiKey();
    if (shared) {
      return NextResponse.json({
        api_key: shared,
        source: "shared",
        hint: shared.slice(-4),
      });
    }

    return NextResponse.json(
      {
        error:
          "Tidak ada API key OpenSea. User perlu login ke website supaya key-nya " +
          "dibuat, atau refresh manual dari halaman /aco.",
      },
      { status: 404 }
    );
  } catch (err) {
    console.error("[internal/opensea-key] error:", err?.message ?? err);
    return NextResponse.json({ error: "Gagal ambil API key." }, { status: 500 });
  }
}
