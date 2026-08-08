import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { verifyDiscordToken } from "./mobileAuth";

export async function getAuthContext(req) {
  const authHeader = req.headers.get("authorization") || "";

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    const result = await verifyDiscordToken(token);
    if (!result.user) return null;
    return {
      isMember: result.isMember,
      isAdmin: result.isAdmin,
      username: result.user.username,
    };
  }

  const session = await getServerSession(authOptions);
  if (!session) return null;

  return {
    isMember: Boolean(session.isMember),
    isAdmin: Boolean(session.isAdmin),
    username: session.user?.name,
  };
}
