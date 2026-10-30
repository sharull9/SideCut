import { describe, expect, it } from "vite-plus/test";
import { RecentClipBuffer } from "./recent-clips";

describe("recent clip retention", () => {
  it("retains at most 60 seconds and selects complete 30/60-second windows", () => {
    const buffer = new RecentClipBuffer<number>();
    for (let i = 0; i < 100; i++)
      buffer.append({ start: i * 5, end: i * 5 + 5, bytes: 10, value: i });
    expect(buffer.bytes).toBe(120);
    expect(buffer.snapshot(60).segments.map((s) => s.value)).toEqual(
      Array.from({ length: 12 }, (_, i) => 88 + i),
    );
    expect(buffer.snapshot(30).segments.map((s) => s.value)).toEqual([94, 95, 96, 97, 98, 99]);
  });
  it("evicts by bytes and rejects invalid or overlapping segments", () => {
    const buffer = new RecentClipBuffer<string>(15);
    buffer.append({ start: 0, end: 5, bytes: 10, value: "first" });
    buffer.append({ start: 5, end: 10, bytes: 10, value: "second" });
    expect(buffer.snapshot(60).segments.map((s) => s.value)).toEqual(["second"]);
    expect(() => buffer.append({ start: 9, end: 12, bytes: 1, value: "overlap" })).toThrow();
    expect(() => buffer.append({ start: 10, end: Infinity, bytes: 1, value: "invalid" })).toThrow();
    buffer.append({ start: 10, end: 15, bytes: 16, value: "oversize" });
    expect(buffer.bytes).toBe(0);
    expect(() => buffer.snapshot(60)).toThrow("No recent");
  });
  it("rebases retained markers and clip marks without exposing mutable buffer state", () => {
    const buffer = new RecentClipBuffer<null>();
    buffer.append({ start: 0, end: 5, bytes: 1, value: null });
    buffer.mark({ time: 2, label: "Old", kind: "marker" });
    buffer.mark({ time: 62, label: " Start ", kind: "clip-start" });
    buffer.mark({ time: 64, label: "End", kind: "clip-end" });
    buffer.append({ start: 60, end: 65, bytes: 1, value: null });
    const snapshot = buffer.snapshot(30);
    expect(snapshot.marks).toEqual([
      { time: 2, label: "Start", kind: "clip-start" },
      { time: 4, label: "End", kind: "clip-end" },
    ]);
    const mark = snapshot.marks[0];
    if (!mark) throw new Error("Expected a mark.");
    mark.label = "mutated";
    expect(buffer.snapshot(30).marks[0]?.label).toBe("Start");
    expect(() => buffer.mark({ time: NaN, label: "No", kind: "marker" })).toThrow();
    expect(() => buffer.mark({ time: 65, label: " ", kind: "marker" })).toThrow();
  });
});
