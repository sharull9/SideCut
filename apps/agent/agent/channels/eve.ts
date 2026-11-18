import { timingSafeEqual } from "node:crypto";
import { extractBearerToken, localDev, type AuthFn } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";

/**
 * The desktop app starts this agent with a random token and gives it only to its own window,
 * so nothing else on the machine can open a session.
 */
const desktopToken: AuthFn<Request> = (request) => {
  const expected = process.env.SIDECUT_AGENT_TOKEN;
  const token = extractBearerToken(request.headers.get("authorization"));
  if (!expected || !token) return null;
  const given = Buffer.from(token),
    wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
  return {
    authenticator: "sidecut-desktop",
    principalType: "user",
    principalId: "desktop-user",
    attributes: {},
  };
};

export default eveChannel({
  auth: [desktopToken, localDev()],
  // The window loads from sidecut://app (or a dev server) and calls this server on 127.0.0.1.
  // Channel config is compiled at build time, so the origin can't come from the environment.
  // Permissive CORS is safe here: there are no cookies, and every session route needs the
  // per-launch bearer token above.
  cors: true,
});
