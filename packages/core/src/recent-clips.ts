export type LiveMark = { time: number; label: string; kind: "marker" | "clip-start" | "clip-end" };
export type RecentSegment<T> = { start: number; end: number; bytes: number; value: T };

/** Retains independently decodable segments, never arbitrary container fragments. */
export class RecentClipBuffer<T> {
  private segments: RecentSegment<T>[] = [];
  private marks: LiveMark[] = [];
  private end = 0;
  constructor(private readonly maxBytes = 64 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid buffer limit.");
  }
  get bytes() {
    return this.segments.reduce((sum, segment) => sum + segment.bytes, 0);
  }
  append(segment: RecentSegment<T>) {
    if (
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.start < this.end ||
      segment.end <= segment.start ||
      !Number.isSafeInteger(segment.bytes) ||
      segment.bytes < 1
    )
      throw new Error("Invalid recent-clip segment.");
    this.end = segment.end;
    this.segments.push({ ...segment });
    while (true) {
      const first = this.segments[0];
      if (
        !first ||
        (this.bytes <= this.maxBytes && first.start >= this.end - 60 && this.segments.length <= 120)
      )
        break;
      this.segments.shift();
    }
    this.marks = this.marks.filter((mark) => mark.time >= this.end - 60);
  }
  mark(mark: LiveMark) {
    if (
      !Number.isFinite(mark.time) ||
      mark.time < 0 ||
      !["marker", "clip-start", "clip-end"].includes(mark.kind) ||
      !mark.label.trim() ||
      mark.label.length > 200
    )
      throw new Error("Invalid live mark.");
    if (this.marks.length >= 500) throw new Error("Live mark limit reached.");
    this.marks.push({ ...mark, label: mark.label.trim() });
  }
  snapshot(seconds: 30 | 60) {
    if (seconds !== 30 && seconds !== 60) throw new Error("Choose 30 or 60 seconds.");
    const segments = this.segments.filter((segment) => segment.start >= this.end - seconds);
    const first = segments[0];
    if (!first) throw new Error("No recent footage is available.");
    return {
      segments: segments.map((segment) => ({ ...segment })),
      start: first.start,
      end: this.end,
      marks: this.marks
        .filter((mark) => mark.time >= first.start && mark.time <= this.end)
        .map((mark) => ({ ...mark, time: mark.time - first.start })),
    };
  }
}
