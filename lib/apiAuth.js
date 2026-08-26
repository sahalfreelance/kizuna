import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { verifyDiscordToken, TokenStatus } from "./mobileAuth";

/**
 * Konteks autentikasi untuk route API, mendukung dua jalur:
 *   - Bearer token (app mobile)
 *   - Session NextAuth (dashboard web)
 *
 * PERUBAHAN: dulu fungsi ini balikin `null` untuk semua kegagalan, dan
 * route menerjemahkan null jadi 401 Unauthorized. Jadi saat Discord rate
 * limit, user mobile yang sah dapat 401 -> app membuang token -> "Sesi
 * berakhir, silakan masuk ulang". Itu penyebab loop refresh/login.
 *
 * Sekarang hasilnya membedakan gagal-karena-token dari gagal-sementara,
 * supaya route bisa membalas 503 (boleh dicoba lagi) alih-alih 401.
 */

export const AuthFailure = {
  /** Tidak ada kredensial sama sekali. */
  NO_CREDENTIALS: "NO_CREDENTIALS",
  /** Token/sesi tidak berlaku -> user perlu login ulang. */
  INVALID_TOKEN: "INVALID_TOKEN",
  /** Discord bermasalah -> jangan usir user, minta coba lagi. */
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
};

export async function getAuthContext(req) {
  const authHeader = req.headers.get("authorization") || "";

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();

    if (!token) {
      return { ok: false, failure: AuthFailure.NO_CREDENTIALS };
    }

    const result = await verifyDiscordToken(token);

    if (result.status === TokenStatus.UPSTREAM_ERROR) {
      return { ok: false, failure: AuthFailure.UPSTREAM_ERROR };
    }
    if (result.status === TokenStatus.INVALID_TOKEN) {
      return { ok: false, failure: AuthFailure.INVALID_TOKEN };
    }

    // OK atau NOT_MEMBER -> kredensial sah, tinggal cek isMember.
    return {
      ok: true,
      isMember: result.isMember,
      isAdmin: result.isAdmin,
      username: result.user?.username,
    };
  }

  const session = await getServerSession(authOptions);
  if (!session) {
    return { ok: false, failure: AuthFailure.NO_CREDENTIALS };
  }

  return {
    ok: true,
    isMember: Boolean(session.isMember),
    isAdmin: Boolean(session.isAdmin),
    username: session.user?.name,
  };
}

/**
 * Helper supaya tiap route tidak menulis ulang logika kode status.
 * Balikin NextResponse kalau HARUS ditolak, atau null kalau lolos.
 *
 * Pemakaian:
 *     const auth = await getAuthContext(req);
 *     const denied = denyResponse(auth, { requireAdmin: false });
 *     if (denied) return denied;
 */
export function buildDenial(auth, NextResponse, { requireAdmin = false } = {}) {
  if (!auth?.ok) {
    if (auth?.failure === AuthFailure.UPSTREAM_ERROR) {
      return NextResponse.json(
        {
          error: "Tidak bisa memverifikasi ke Discord saat ini. Coba lagi.",
          retryable: true,
        },
        { status: 503 }
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
