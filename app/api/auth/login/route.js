import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  normalizeUsername,
  normalizeDeviceId,
  verifyPassword,
  createSessionToken,
  SESSION_COOKIE,
  DEFAULT_TTL_DAYS,
} from "@/lib/localAuth";

/**
 * POST /api/auth/login
 * body: { username, password, device_id, device_label? }
 *
 * Balikan:
 *   200 -> { user, token }  + cookie httpOnly (buat web)
 *   400 -> field kurang / device_id tidak valid
 *   401 -> username atau password salah
 *   403 -> DEVICE_MISMATCH / DEVICE_TAKEN / INACTIVE  (pakai `code`)
 *
 * App Android pakai `token` di header Authorization: Bearer <token>.
 * Web cukup andalkan cookie-nya.
 */

// Jeda tetap untuk semua kegagalan kredensial. Tanpa ini, "user tidak ada"
// (tanpa hashing) selesai jauh lebih cepat dari "password salah" (dengan
// scrypt ~60ms), dan selisih itu bisa dipakai menebak username mana yang ada.
const MIN_FAIL_MS = 120;

async function padDelay(startedAt) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_FAIL_MS) {
    await new Promise((r) => setTimeout(r, MIN_FAIL_MS - elapsed));
  }
}

function clientIp(req) {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || req.headers.get("x-real-ip") || null;
}

async function logEvent(row) {
  // Audit best-effort. Gagal nulis log tidak boleh menggagalkan login.
  try {
    await supabaseAdmin.from("app_login_events").insert(row);
  } catch (e) {
    console.error("[login] gagal catat event:", e?.message ?? e);
  }
}

export async function POST(req) {
  const startedAt = Date.now();

  const body = await req.json().catch(() => null);
  const username = normalizeUsername(body?.username);
  const password = String(body?.password || "");
  const deviceId = normalizeDeviceId(body?.device_id);
  const deviceLabel = body?.device_label ? String(body.device_label).slice(0, 120) : null;

  const ip = clientIp(req);
  const userAgent = (req.headers.get("user-agent") || "").slice(0, 300);

  if (!username || !password) {
    return NextResponse.json(
      { error: "Username dan password wajib diisi." },
      { status: 400 }
    );
  }
  if (!deviceId) {
    return NextResponse.json(
      {
        error: "device_id tidak valid atau tidak dikirim.",
        code: "BAD_DEVICE_ID",
      },
      { status: 400 }
    );
  }

  const { data: user, error } = await supabaseAdmin
    .from("app_users")
    .select("*")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    console.error("[login] query gagal:", error.message);
    return NextResponse.json(
      { error: "Terjadi gangguan. Coba lagi.", retryable: true },
      { status: 503 }
    );
  }

  // Pesan error DISENGAJA sama untuk "user tidak ada" dan "password salah",
  // supaya tidak bisa dipakai menebak username yang terdaftar.
  const CREDENTIAL_ERROR = "Username atau password salah.";

  if (!user) {
    await logEvent({ username, device_id: deviceId, result: "NO_USER", ip, user_agent: userAgent });
    await padDelay(startedAt);
    return NextResponse.json({ error: CREDENTIAL_ERROR }, { status: 401 });
  }

  if (!verifyPassword(password, user.password_hash)) {
    await logEvent({
      user_id: user.id,
      username,
      device_id: deviceId,
      result: "BAD_PASSWORD",
      ip,
      user_agent: userAgent,
    });
    await padDelay(startedAt);
    return NextResponse.json({ error: CREDENTIAL_ERROR }, { status: 401 });
  }

  if (!user.is_active) {
    await logEvent({
      user_id: user.id,
      username,
      device_id: deviceId,
      result: "INACTIVE",
      ip,
      user_agent: userAgent,
    });
    return NextResponse.json(
      { error: "Akun ini dinonaktifkan. Hubungi admin.", code: "INACTIVE" },
      { status: 403 }
    );
  }

  // --- Aturan 1 user 1 device ---------------------------------------------

  if (user.device_id && user.device_id !== deviceId) {
    await logEvent({
      user_id: user.id,
      username,
      device_id: deviceId,
      result: "DEVICE_MISMATCH",
      ip,
      user_agent: userAgent,
    });
    return NextResponse.json(
      {
        error:
          "Akun ini sudah terikat ke perangkat lain. Jalankan /reset-device di bot Discord untuk pindah perangkat.",
        code: "DEVICE_MISMATCH",
        bound_device_label: user.device_label || null,
      },
      { status: 403 }
    );
  }

  // Device belum terikat -> ikat sekarang. Tapi device yang sama tidak boleh
  // dipakai akun lain (1 device 1 user).
  if (!user.device_id) {
    const { data: deviceOwner } = await supabaseAdmin
      .from("app_users")
      .select("id, display_username")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (deviceOwner && deviceOwner.id !== user.id) {
      await logEvent({
        user_id: user.id,
        username,
        device_id: deviceId,
        result: "DEVICE_TAKEN",
        ip,
        user_agent: userAgent,
      });
      return NextResponse.json(
        {
          error:
            "Perangkat ini sudah dipakai akun lain. Satu perangkat hanya untuk satu akun.",
          code: "DEVICE_TAKEN",
        },
        { status: 403 }
      );
    }

    const { error: bindError } = await supabaseAdmin
      .from("app_users")
      .update({
        device_id: deviceId,
        device_label: deviceLabel,
        device_bound_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id)
      // Kunci anti-race: hanya update kalau device_id MASIH null. Kalau dua
      // request masuk bersamaan, yang kedua tidak kena baris ini.
      .is("device_id", null);

    if (bindError) {
      // Pelanggaran UNIQUE index -> device direbut request lain barusan.
      console.error("[login] gagal bind device:", bindError.message);
      return NextResponse.json(
        {
          error: "Perangkat ini sudah dipakai akun lain.",
          code: "DEVICE_TAKEN",
        },
        { status: 403 }
      );
    }

    // Pastikan binding-nya beneran jadi milik kita (bukan kalah race).
    const { data: recheck } = await supabaseAdmin
      .from("app_users")
      .select("device_id")
      .eq("id", user.id)
      .maybeSingle();

    if (recheck?.device_id !== deviceId) {
      return NextResponse.json(
        {
          error: "Gagal mengikat perangkat. Coba lagi.",
          code: "DEVICE_BIND_FAILED",
          retryable: true,
        },
        { status: 409 }
      );
    }
  }

  // --- Sukses -------------------------------------------------------------

  const token = createSessionToken({
    userId: user.id,
    username: user.username,
    deviceId,
    sessionVersion: user.session_version,
    isAdmin: user.is_admin,
  });

  await supabaseAdmin
    .from("app_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id);

  await logEvent({
    user_id: user.id,
    username,
    device_id: deviceId,
    result: "OK",
    ip,
    user_agent: userAgent,
  });

  const res = NextResponse.json({
    user: {
      id: user.id,
      username: user.display_username,
      isAdmin: user.is_admin,
      isMember: true,
      deviceBound: true,
    },
    token,
    expires_in: DEFAULT_TTL_DAYS * 86400,
  });

  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DEFAULT_TTL_DAYS * 86400,
  });

  return res;
}
