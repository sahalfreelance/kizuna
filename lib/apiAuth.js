import { supabaseAdmin } from "./supabase";
import { verifySessionToken, SESSION_COOKIE } from "./localAuth";

/**
 * Konteks autentikasi untuk route API.
 *
 * Urutan yang dicoba:
 *   1. Cookie sesi lokal         (web)
 *   2. Bearer <token sesi lokal> (app Android)
 *
 * Discord OAuth sudah dibuang total — login sekarang username + password,
 * akun dibuat lewat bot Discord.
 *
 * Hasilnya membedakan gagal-karena-kredensial dari gagal-sementara, supaya
 * route bisa membalas 503 (boleh dicoba lagi) alih-alih 401 — kalau semua
 * kegagalan jadi 401, app membuang token dan memaksa login ulang padahal
 * kredensialnya sehat.
 */

export const AuthFailure = {
  /** Tidak ada kredensial sama sekali. */
  NO_CREDENTIALS: "NO_CREDENTIALS",
  /** Token/sesi tidak berlaku -> user perlu login ulang. */
  INVALID_TOKEN: "INVALID_TOKEN",
  /** Database bermasalah -> jangan usir user, minta coba lagi. */
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  /** Token sah tapi dipakai dari perangkat lain. */
  DEVICE_MISMATCH: "DEVICE_MISMATCH",
};

/**
 * Cek token sesi lokal terhadap database.
 *
 * Tanda tangan token sudah diverifikasi tanpa DB, tapi `session_version`
 * WAJIB dicek ke DB — itulah yang membuat ganti password / reset device bisa
 * mematikan token lama tanpa perlu menyimpan daftar token aktif.
 */
async function resolveLocalToken(token) {
  const verified = verifySessionToken(token);
  if (!verified.ok) {
    return { ok: false, failure: AuthFailure.INVALID_TOKEN };
  }

  const { payload } = verified;

  const { data: user, error } = await supabaseAdmin
    .from("app_users")
    .select("id, username, display_username, is_admin, is_active, session_version, device_id")
    .eq("id", payload.uid)
    .maybeSingle();

  if (error) {
    console.error("[apiAuth] query app_users gagal:", error.message);
    return { ok: false, failure: AuthFailure.UPSTREAM_ERROR };
  }
  if (!user || !user.is_active) {
    return { ok: false, failure: AuthFailure.INVALID_TOKEN };
  }
  // Password diganti / device di-reset -> semua token lama mati.
  if (user.session_version !== payload.sv) {
    return { ok: false, failure: AuthFailure.INVALID_TOKEN };
  }
  // Token dipakai dari perangkat yang bukan perangkat terikat.
  if (user.device_id && payload.did && user.device_id !== payload.did) {
    return { ok: false, failure: AuthFailure.DEVICE_MISMATCH };
  }

  return {
    ok: true,
    isMember: true,
    isAdmin: user.is_admin,
    username: user.display_username || user.username,
    userId: user.id,
    deviceId: payload.did,
    authType: "local",
  };
}

export async function getAuthContext(req) {
  // 1. Cookie sesi lokal (web)
  const cookieToken = req.cookies?.get?.(SESSION_COOKIE)?.value;
  if (cookieToken) {
    const result = await resolveLocalToken(cookieToken);
    // Cookie busuk bukan alasan berhenti — mungkin ada Bearer yang sah.
    if (result.ok) return result;
    if (result.failure === AuthFailure.UPSTREAM_ERROR) return result;
  }

  const authHeader = req.headers.get("authorization") || "";

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();

    if (!token) {
      return { ok: false, failure: AuthFailure.NO_CREDENTIALS };
    }

    // 2. Token sesi lokal (app Android).
    return await resolveLocalToken(token);
  }

  return { ok: false, failure: AuthFailure.NO_CREDENTIALS };
}

/**
 * Helper supaya tiap route tidak menulis ulang logika kode status.
 * Balikin NextResponse kalau HARUS ditolak, atau null kalau lolos.
 */
export function buildDenial(auth, NextResponse, { requireAdmin = false } = {}) {
  if (!auth?.ok) {
    if (auth?.failure === AuthFailure.UPSTREAM_ERROR) {
      return NextResponse.json(
        {
          error: "Tidak bisa memverifikasi sesi saat ini. Coba lagi.",
          retryable: true,
        },
        { status: 503 }
      );
    }

    if (auth?.failure === AuthFailure.DEVICE_MISMATCH) {
      return NextResponse.json(
        {
          error:
            "Sesi ini dipakai dari perangkat lain. Jalankan /reset-device di bot Discord.",
          code: "DEVICE_MISMATCH",
          need_relogin: true,
        },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: "Unauthorized", need_relogin: true },
      { status: 401 }
    );
  }

  if (!auth.isMember) {
    return NextResponse.json(
      { error: "Kamu bukan anggota server House of Kizuna." },
      { status: 403 }
    );
  }

  if (requireAdmin && !auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
