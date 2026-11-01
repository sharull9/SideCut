import { describe, expect, it } from "vite-plus/test";
import { LiveChat } from "./live-chat";
import { LiveCaptions } from "./live-captions";
import { LiveCompanion } from "./live-companion";

const message = {
  id: "m",
  provider: "twitch",
  authorID: "u",
  author: "Viewer",
  text: "Hello Kappa",
  time: 1,
  emotes: [{ start: 6, end: 11, text: "Kappa" }],
};
const update = { id: "s", revision: 0, final: false, words: [{ text: "Hello", start: 0, end: 1 }] };
const profile = { id: "cat", name: "Mochi", avatar: "cat", color: "#38bdf8", animated: true };

describe("live chat and audience", () => {
  it("isolates provider IDs, deduplicates replays and rejects stale/disconnected callbacks", () => {
    const chat = new LiveChat();
    const generation = chat.connect("twitch");
    expect(chat.receive(message, generation)).toBe(true);
    expect(chat.receive(message, generation)).toBe(false);
    chat.highlight("twitch", "m");
    expect(chat.overlay(1)?.text).toBe("Viewer: Hello Kappa");
    chat.hide("twitch", "m");
    expect(chat.overlay(1)).toBeNull();
    expect(chat.receive(message, generation)).toBe(false);
    const next = chat.connect("twitch");
    expect(chat.receive({ ...message, id: "stale" }, generation)).toBe(false);
    chat.disconnect("twitch", generation);
    expect(chat.receive({ ...message, id: "new" }, next)).toBe(true);
    chat.disconnect("twitch", next, true);
    expect(chat.receive({ ...message, id: "late" }, next)).toBe(false);
    expect(chat.status()[0]?.state).toBe("quota");
    expect(chat.status()[0]?.provider).toBe("twitch");
    const youtube = chat.connect("youtube");
    expect(chat.receive({ ...message, provider: "youtube" }, youtube)).toBe(true);
  });
  it("bounds retained state, clears evicted highlights and handles stale viewer counts", () => {
    const chat = new LiveChat();
    const generation = chat.connect("twitch");
    chat.receive(message, generation);
    chat.highlight("twitch", "m");
    for (let i = 0; i < 501; i++) chat.receive({ ...message, id: `m${i}` }, generation);
    expect(chat.list()).toHaveLength(500);
    expect(chat.overlay(1)).toBeNull();
    const event = { id: "e", provider: "twitch", kind: "viewers", count: 100, time: 2 };
    expect(chat.audience(event, generation)).toBe(true);
    expect(chat.audience(event, generation)).toBe(false);
    chat.audience({ ...event, id: "old", count: 1, time: 1 }, generation);
    expect(chat.status()[0]?.viewers).toBe(100);
    expect(chat.audienceEvents()).toHaveLength(2);
    chat.disconnect("twitch", generation);
    expect(chat.status()[0]?.viewers).toBeNull();
    expect(() =>
      chat.receive({ ...message, emotes: [{ start: 0, end: 99, text: "bad" }] }, generation),
    ).toThrow();
  });
});

describe("live caption reconciliation", () => {
  it("replaces partials, freezes finals, routes targets and measures observed latency", () => {
    const captions = new LiveCaptions();
    const generation = captions.connect();
    expect(captions.receive(update, generation, 1.2)).toBe(true);
    expect(captions.text("preview", 1)).toBe("Hello");
    expect(captions.text("record", 1)).toBe("");
    expect(
      captions.receive(
        { ...update, revision: 1, final: true, words: [{ text: "World", start: 0, end: 1 }] },
        generation,
        1.5,
      ),
    ).toBe(true);
    expect(captions.receive({ ...update, revision: 2 }, generation, 1.5)).toBe(false);
    captions.route(["record", "stream"]);
    expect(captions.text("preview", 1)).toBe("");
    expect(captions.text("record", 1)).toBe("World");
    expect(captions.status().latencySeconds).toBe(0.5);
    expect(captions.text("stream", 3)).toBe("");
  });
  it("removes abandoned partials on disconnect, retains finals and rejects old transports", () => {
    const captions = new LiveCaptions();
    const generation = captions.connect();
    captions.receive({ ...update, final: true }, generation, 1);
    captions.receive({ ...update, id: "partial" }, generation, 1);
    captions.disconnect();
    expect(captions.words("preview")).toHaveLength(1);
    const next = captions.connect();
    expect(captions.receive({ ...update, id: "late" }, generation, 1)).toBe(false);
    expect(captions.receive({ ...update, id: "next" }, next, 1)).toBe(true);
    expect(() =>
      captions.receive({ ...update, words: [{ text: "bad", start: 2, end: 1 }] }, next, 2),
    ).toThrow();
    expect(() => captions.receive(update, next, NaN)).toThrow();
  });
});

describe("companion appearance and activation", () => {
  it("requires explicit activation including after restore, and removes active profiles safely", () => {
    const companion = new LiveCompanion();
    companion.save(profile);
    expect(companion.frame(0)).toBeNull();
    expect(() => companion.react("happy", 0)).toThrow();
    companion.activate("cat");
    companion.react("happy", 1);
    expect(companion.frame(1.125)?.scale).toBeGreaterThan(1);
    expect(companion.frame(1.125, true)?.scale).toBe(1);
    expect(companion.frame(3)?.reaction).toBeNull();
    const restored = LiveCompanion.restore(companion.serialize());
    expect(restored.list()).toEqual([profile]);
    expect(restored.frame(0)).toBeNull();
    companion.remove("cat");
    expect(companion.frame(0)).toBeNull();
  });
  it("validates profiles, prevents library overflow and returns defensive copies", () => {
    const companion = new LiveCompanion();
    companion.save(profile);
    const list = companion.list();
    list.pop();
    expect(companion.list()).toHaveLength(1);
    expect(() => companion.save({ ...profile, color: "url(https://untrusted)" })).toThrow();
    for (let i = 1; i < 20; i++) companion.save({ ...profile, id: `p${i}` });
    expect(() => companion.save({ ...profile, id: "overflow" })).toThrow();
    expect(() =>
      LiveCompanion.restore(JSON.stringify({ version: 1, profiles: [profile, profile] })),
    ).toThrow();
  });
});
