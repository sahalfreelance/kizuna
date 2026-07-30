import DiscordProvider from "next-auth/providers/discord";
import { getGuildMembership } from "./discord";

export const authOptions = {
  providers: [
    DiscordProvider({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      authorization: {
        params: { scope: "identify guilds guilds.members.read" },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, account, profile }) {
      // account & profile hanya ada sesaat setelah login pertama kali
      if (account && profile) {
        const membership = await getGuildMembership(account.access_token);
        token.isMember = membership.isMember;
        token.isAdmin = membership.isAdmin;
        token.discordId = profile.id;
        token.username = profile.username;
        token.avatar = profile.image_url || null;
      }
      return token;
    },
    async session({ session, token }) {
      session.isMember = Boolean(token.isMember);
      session.isAdmin = Boolean(token.isAdmin);
      if (session.user) {
        session.user.discordId = token.discordId;
        session.user.name = token.username || session.user.name;
      }
      return session;
    },
  },
};
