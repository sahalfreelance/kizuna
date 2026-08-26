const GUILD_ID = process.env.DISCORD_GUILD_ID;
const ADMIN_ROLE_IDS = (process.env.DISCORD_ADMIN_ROLE_IDS || "")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

/**
 * Cek apakah user (berdasarkan access_token OAuth Discord miliknya) adalah
 * anggota server komunitas kita, dan apakah dia punya salah satu role admin.
 *
 * Butuh scope OAuth: "identify guilds guilds.members.read"
 * Endpoint ini TIDAK butuh bot, cukup token milik user sendiri.
 *
 * ====================== PERUBAHAN PENTING ======================
 * Versi lama menganggap SEMUA respons non-ok sebagai "bukan member":
 *
 *     if (!res.ok) return { isMember: false, ... }
 *
 * Itu menyamakan tiga hal yang sangat berbeda:
 *   404 -> user memang bukan anggota server        (fakta)
 *   401 -> access token user kadaluarsa/dicabut    (soal sesi)
 *   429 -> kita kena rate limit Discord            (soal sementara)
 *   5xx -> Discord sedang gangguan                 (soal sementara)
 *
 * Akibatnya user yang sah bisa mendadak dianggap bukan member setiap kali
 * Discord membalas 429/5xx — muncul "Akses ditolak", lalu kalau dicoba
 * lagi malah berhasil. Itu persis gejala login yang kadang ditolak kadang
 * lolos.
 *
 * Sekarang hasilnya membawa `status`, dan pemanggil bisa membedakan
 * "bukan member" dari "gagal memastikan".
 */

/** Status hasil pengecekan keanggotaan. */
export const MembershipStatus = {
  /** Terkonfirmasi anggota server. */
  MEMBER: "MEMBER",
  /** Terkonfirmasi BUKAN anggota (Discord balas 404). */
  NOT_MEMBER: "NOT_MEMBER",
  /** Token user tidak berlaku — bukan soal keanggotaan. */
  INVALID_TOKEN: "INVALID_TOKEN",
  /** Discord rate limit / gangguan / jaringan. Tidak bisa disimpulkan. */
  UNKNOWN: "UNKNOWN",
};

const MAX_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getGuildMembership(accessToken) {
  let lastStatus = MembershipStatus.UNKNOWN;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await fetch(
        `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        }
      );
    } catch (err) {
      console.error(
        `[discord] gagal hubungi Discord (attempt ${attempt}):`,
        err?.message ?? err
      );
      lastStatus = MembershipStatus.UNKNOWN;
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 400);
      continue;
    }

    if (res.ok) {
      const member = await res.json();
      const roles = member.roles || [];
      const isAdmin = roles.some((roleId) => ADMIN_ROLE_IDS.includes(roleId));
      return {
        status: MembershipStatus.MEMBER,
        isMember: true,
        isAdmin,
        roles,
      };
    }

    // 404 = jawaban pasti: user bukan anggota server ini.
    if (res.status === 404) {
      return {
        status: MembershipStatus.NOT_MEMBER,
        isMember: false,
        isAdmin: false,
        roles: [],
      };
    }

    // 401/403 = token user bermasalah, bukan soal keanggotaan.
    if (res.status === 401 || res.status === 403) {
      return {
        status: MembershipStatus.INVALID_TOKEN,
        isMember: false,
        isAdmin: false,
        roles: [],
      };
    }

    // 429 = rate limit. Discord memberi tahu harus menunggu berapa lama.
    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      const waitMs = Math.min(
        Math.ceil((body?.retry_after ?? 1) * 1000) + 100,
        5000
      );
      console.warn(
        `[discord] rate limited, tunggu ${waitMs}ms (attempt ${attempt})`
      );
      lastStatus = MembershipStatus.UNKNOWN;
      if (attempt < MAX_ATTEMPTS) await sleep(waitMs);
      continue;
    }

    // 5xx = Discord gangguan. Coba lagi.
    console.warn(
      `[discord] respons tak terduga ${res.status} (attempt ${attempt})`
    );
    lastStatus = MembershipStatus.UNKNOWN;
    if (attempt < MAX_ATTEMPTS) await sleep(attempt * 400);
  }

  // Semua percobaan gagal tanpa jawaban pasti. JANGAN mengaku "bukan
  // member" — itu yang dulu bikin user sah kena "Akses ditolak".
  return {
    status: lastStatus,
    isMember: false,
    isAdmin: false,
    roles: [],
  };
}
