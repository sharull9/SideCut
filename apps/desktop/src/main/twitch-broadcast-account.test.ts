import { describe, expect, it } from "vite-plus/test";
import { TwitchBroadcastAccount } from "./twitch-broadcast-account.ts";

describe("host Twitch account adapter", () => {
  it("retrieves keys from the fixed API and clears authority on disconnect", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const request: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return calls.length === 1
        ? Response.json({ data: [{ stream_key: "private-key" }] })
        : new Response(null, { status: 204 });
    };
    const account = new TwitchBroadcastAccount("client", "token", "123", request);
    await expect(account.destination("rtmp://live.twitch.tv/app")).resolves.toBe(
      "rtmp://live.twitch.tv/app/private-key",
    );
    await account.updateTitle("Fixture");
    expect(calls[0]?.url).toBe("https://api.twitch.tv/helix/streams/key?broadcaster_id=123");
    expect(calls[1]?.init?.method).toBe("PATCH");
    account.disconnect();
    await expect(account.updateTitle("Another")).rejects.toThrow(/disconnected/);
    expect(calls).toHaveLength(2);
  });

  it.each([401, 403, 429, 500])("redacts provider errors (%s)", async (status) => {
    const account = new TwitchBroadcastAccount(
      "client",
      "secret-token",
      "123",
      async () => new Response("secret-provider-body", { status }),
    );
    await expect(account.updateTitle("Fixture")).rejects.toThrow(
      status === 401 ? /expired/ : status === 429 ? /rate limit/ : /request failed/,
    );
    await expect(account.destination("rtmp://attacker.test/app")).rejects.toThrow(/ingest/);
  });
});
