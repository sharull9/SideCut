import { Schema } from "effect";
import type { LiveOverlay } from "./live-assets";

const label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100));
const providerSchema = Schema.Literals(["youtube", "twitch", "kick", "x"]);
const messageSchema = Schema.Struct({
  id: label,
  provider: providerSchema,
  authorID: label,
  author: label,
  text: Schema.String.check(Schema.isMaxLength(2000)),
  time: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  emotes: Schema.Array(
    Schema.Struct({
      start: Schema.Int,
      end: Schema.Int,
      text: label,
    }),
  ),
});
const audienceSchema = Schema.Struct({
  id: label,
  provider: providerSchema,
  kind: Schema.Literals(["viewers", "follow", "subscription", "raid"]),
  count: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(1_000_000_000),
  ),
  time: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type ChatMessage = typeof messageSchema.Type;
export type ChatProvider = ChatMessage["provider"];
type Connection = { generation: number; state: "connected" | "disconnected" | "quota" };

/** Normalized adapter input only. Local hiding does not claim remote moderation. */
export class LiveChat {
  private connections = new Map<ChatProvider, Connection>();
  private messages = new Map<string, ChatMessage>();
  private events = new Map<string, typeof audienceSchema.Type>();
  private seen = new Map<string, true>();
  private viewers = new Map<ChatProvider, { count: number; time: number }>();
  private selected: string | null = null;

  connect(provider: ChatProvider) {
    const generation = (this.connections.get(provider)?.generation ?? 0) + 1;
    this.connections.set(provider, { generation, state: "connected" });
    this.viewers.delete(provider);
    return generation;
  }
  disconnect(provider: ChatProvider, generation: number, quota = false) {
    const connection = this.connections.get(provider);
    if (connection?.generation !== generation) return;
    connection.state = quota ? "quota" : "disconnected";
    this.viewers.delete(provider);
  }
  private accepts(provider: ChatProvider, generation: number) {
    const connection = this.connections.get(provider);
    return connection?.generation === generation && connection.state === "connected";
  }
  receive(input: unknown, generation: number) {
    const message = Schema.decodeUnknownSync(messageSchema)(input);
    if (message.emotes.length > 100) throw new Error("Too many emotes.");
    let end = 0;
    for (const emote of message.emotes) {
      if (emote.start < end || emote.end <= emote.start || emote.end > message.text.length)
        throw new Error("Invalid emote text range.");
      end = emote.end;
    }
    const key = `${message.provider}:${message.id}`;
    if (!this.accepts(message.provider, generation) || this.seen.has(key)) return false;
    this.seen.set(key, true);
    if (this.seen.size > 1000) {
      const oldest = this.seen.keys().next().value;
      if (oldest) this.seen.delete(oldest);
    }
    this.messages.set(key, structuredClone(message));
    if (this.messages.size > 500) {
      const oldest = this.messages.keys().next().value;
      if (oldest) this.messages.delete(oldest);
      if (this.selected === oldest) this.selected = null;
    }
    return true;
  }
  audience(input: unknown, generation: number) {
    const event = Schema.decodeUnknownSync(audienceSchema)(input);
    const key = `${event.provider}:${event.id}`;
    if (!this.accepts(event.provider, generation) || this.events.has(key)) return false;
    this.events.set(key, structuredClone(event));
    if (this.events.size > 1000) {
      const oldest = this.events.keys().next().value;
      if (oldest) this.events.delete(oldest);
    }
    if (event.kind === "viewers" && event.time >= (this.viewers.get(event.provider)?.time ?? -1))
      this.viewers.set(event.provider, { count: event.count, time: event.time });
    return true;
  }
  list() {
    return structuredClone([...this.messages.values()]);
  }
  audienceEvents() {
    return structuredClone([...this.events.values()]);
  }
  status() {
    return [...this.connections].map(([provider, connection]) => ({
      provider,
      ...connection,
      viewers: this.viewers.get(provider)?.count ?? null,
    }));
  }
  hide(provider: ChatProvider, id: string) {
    const key = `${provider}:${id}`;
    if (this.selected === key) this.selected = null;
    this.messages.delete(key);
  }
  highlight(provider: ChatProvider, id: string) {
    const key = `${provider}:${id}`;
    if (!this.messages.has(key)) throw new Error("Chat message unavailable.");
    this.selected = key;
  }
  clearHighlight() {
    this.selected = null;
  }
  overlay(time: number): LiveOverlay | null {
    if (!Number.isFinite(time) || time < 0 || time > 86400) throw new Error("Invalid chat time.");
    const message = this.selected ? this.messages.get(this.selected) : undefined;
    return message
      ? {
          id: "live-chat",
          kind: "banner",
          text: `${message.author}: ${message.text}`.slice(0, 500),
          x: 0.05,
          y: 0.7,
          width: 0.9,
          height: 0.12,
          color: "#111827",
          textColor: "#ffffff",
          opacity: 1,
          enabled: true,
          motion: "none",
          start: time,
          duration: 1,
        }
      : null;
  }
}
