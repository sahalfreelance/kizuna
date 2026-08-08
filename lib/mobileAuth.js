import { getGuildMembership } from "./discord";

export async function verifyDiscordToken(accessToken) {
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!meRes.ok) {
    return { isMember: false, isAdmin: false, user: null };
  }

  const me = await meRes.json();
  const membership = await getGuildMembership(accessToken);

  return {
    isMember: membership.isMember,
    isAdmin: membership.isAdmin,
    user: {
      id: me.id,
      username: me.username,
      avatarUrl: me.avatar
        ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png`
        : null,
    },
  };
}
