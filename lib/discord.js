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
 */
export async function getGuildMembership(accessToken) {
  try {
    const res = await fetch(
      `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );

    if (!res.ok) {
      // 404 = user login berhasil tapi bukan member server kita
      return { isMember: false, isAdmin: false, roles: [] };
    }

    const member = await res.json();
    const roles = member.roles || [];
    const isAdmin = roles.some((roleId) => ADMIN_ROLE_IDS.includes(roleId));

    return { isMember: true, isAdmin, roles };
  } catch (err) {
    console.error("Gagal cek keanggotaan Discord:", err);
    return { isMember: false, isAdmin: false, roles: [] };
  }
}
