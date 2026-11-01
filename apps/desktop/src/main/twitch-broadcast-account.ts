import { streamDestination } from "./native-streaming.ts";

/** Host-only adapter. OAuth acquisition/storage and renderer wiring are separate acceptance gates. */
export class TwitchBroadcastAccount {
  private controller = new AbortController();
  constructor(
    private readonly clientID: string,
    private token: string,
    private readonly broadcasterID: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!clientID || !token || !/^\d+$/.test(broadcasterID))
      throw new Error("Invalid Twitch account credentials.");
  }

  disconnect() {
    this.token = "";
    this.controller.abort();
  }

  private async call(path: string, init?: RequestInit): Promise<unknown> {
    if (!this.token) throw new Error("Twitch account disconnected.");
    let response: Response;
    try {
      response = await this.request(`https://api.twitch.tv/helix/${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Client-Id": this.clientID,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]),
        redirect: "error",
      });
    } catch {
      throw new Error("Twitch request interrupted or unavailable.");
    }
    if (!this.token) throw new Error("Twitch account disconnected.");
    if (response.status === 401) {
      this.disconnect();
      throw new Error("Twitch authorization expired. Reconnect the account.");
    }
    if (response.status === 429) throw new Error("Twitch rate limit reached. Retry later.");
    if (!response.ok) throw new Error(`Twitch request failed (${response.status}).`);
    if (response.status === 204) return null;
    try {
      const result: unknown = await response.json();
      if (!this.token) throw new Error("Twitch account disconnected.");
      return result;
    } catch {
      throw new Error("Invalid Twitch response.");
    }
  }

  async destination(ingest: string): Promise<string> {
    // Validate before retrieving a credential; arbitrary fetch hosts are never accepted.
    const base = streamDestination(`${ingest.replace(/\/$/, "")}/placeholder`);
    const host = new URL(base.url).hostname;
    if (!host.endsWith(".twitch.tv")) throw new Error("Use a Twitch ingest server.");
    const result = await this.call(`streams/key?broadcaster_id=${this.broadcasterID}`);
    if (!result || typeof result !== "object" || !("data" in result) || !Array.isArray(result.data))
      throw new Error("Invalid Twitch stream key response.");
    const row: unknown = result.data[0];
    if (
      !row ||
      typeof row !== "object" ||
      !("stream_key" in row) ||
      typeof row.stream_key !== "string" ||
      !row.stream_key
    )
      throw new Error("Invalid Twitch stream key response.");
    return streamDestination(`${ingest.replace(/\/$/, "")}/${row.stream_key}`).url;
  }

  async updateTitle(title: string): Promise<void> {
    if (!title.trim() || title.length > 140) throw new Error("Title needs 1–140 characters.");
    await this.call(`channels?broadcaster_id=${this.broadcasterID}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  }
}
