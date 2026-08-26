import { getGuildMembership, MembershipStatus } from "./discord";

/**
 * Verifikasi access token Discord milik user mobile.
 *
 * PERUBAHAN: hasilnya sekarang membawa `status` supaya route bisa
 * membedakan tiga kondisi yang dulu semuanya jadi 401:
 *
 *   INVALID_TOKEN -> token mati, app harus refresh / user login ulang
 *   NOT_MEMBER    -> token sah, tapi user bukan anggota server
 *   UNKNOWN       -> Discord rate limit / gangguan; JANGAN usir user
 *
 * Dulu `verifyDiscordToken` cuma balikin { isMember, isAdmin, user } dan
 * route memakai `!result.user` sebagai penanda 401. Karena `getGuildMembership`
 * versi lama mengubah rate limit jadi `isMember: false`, user yang sah bisa
 * dapat "Akses ditolak" secara acak.
 */

export const TokenStatus = {
  OK: "OK",
  INVALID_TOKEN: "INVALID_TOKEN",
  NOT_MEMBER: "NOT_MEMBER",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
};

export async function verifyDiscordToken(accessToken) {
  let meRes;
  try {
    meRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch (err) {
    console.error("[mobileAuth] gagal hubungi Discord:", err?.message ?? err);
    return {
      status: TokenStatus.UPSTREAM_ERROR,
      isMember: false,
      isAdmin: false,
      user: null,
    };
  }

  if (!meRes.ok) {
    // 401 = token benar-benar mati. Selain itu (429/5xx) = masalah
    // sementara di sisi Discord, bukan token user.
    const isTokenDead = meRes.status === 401;
    if (!isTokenDead) {
      console.warn(`[mobileAuth] /users/@me balas ${meRes.status}`);
    }
    return {
      status: isTokenDead
        ? TokenStatus.INVALID_TOKEN
        : TokenStatus.UPSTREAM_ERROR,
      isMember: false,
      isAdmin: false,
      user: null,
    };
  }

  const me = await meRes.json();
  const user = {
    id: me.id,
    username: me.username,
    avatarUrl: me.avatar
      ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png`
      : null,
  };

  const membership = await getGuildMembership(accessToken);

  // Token jelas masih hidup (/users/@me sukses), jadi kalau pengecekan
  // keanggotaan gagal karena rate limit / gangguan, itu UPSTREAM_ERROR —
  // bukan "bukan member".
  if (membership.status === MembershipStatus.UNKNOWN) {
    return {
      status: TokenStatus.UPSTREAM_ERROR,
      isMember: false,
      isAdmin: false,
      user,
    };
  }

  if (membership.status === MembershipStatus.INVALID_TOKEN) {
    return {
      status: TokenStatus.INVALID_TOKEN,
      isMember: false,
      isAdmin: false,
      user,
    };
  }

  if (membership.status === MembershipStatus.NOT_MEMBER) {
    return {
      status: TokenStatus.NOT_MEMBER,
      isMember: false,
      isAdmin: false,
      user,
    };
  }

  return {
    status: TokenStatus.OK,
    isMember: true,
    isAdmin: membership.isAdmin,
    user,
  };
}
