import { Schema } from "effect";
import { validateTranscript, type TranscriptWord } from "./transcript";

const updateSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  final: Schema.Boolean,
  words: Schema.Array(
    Schema.Struct({ text: Schema.String, start: Schema.Finite, end: Schema.Finite }),
  ),
});
export type CaptionTarget = "preview" | "record" | "stream";

/** Source times use the studio clock; reconnect invalidates callbacks from the old transport. */
export class LiveCaptions {
  private generation = 0;
  private connected = false;
  private segments = new Map<string, typeof updateSchema.Type>();
  private targets = new Set<CaptionTarget>(["preview"]);
  private latency: number | null = null;
  connect() {
    this.disconnect();
    this.latency = null;
    this.connected = true;
    return ++this.generation;
  }
  disconnect() {
    this.connected = false;
    for (const [id, segment] of this.segments) if (!segment.final) this.segments.delete(id);
  }
  route(targets: readonly CaptionTarget[]) {
    this.targets = new Set(targets);
  }
  receive(input: unknown, generation: number, receivedAt: number) {
    const segment = Schema.decodeUnknownSync(updateSchema)(input);
    if (!Number.isFinite(receivedAt) || receivedAt < 0) throw new Error("Invalid caption clock.");
    validateTranscript({ model: "live", language: "und", words: segment.words });
    if (segment.words.length > 200 || segment.words.some((word) => word.text.length > 200))
      throw new Error("Caption update exceeds its word limit.");
    let end = 0;
    for (const word of segment.words) {
      if (word.start < end || word.end > receivedAt + 1)
        throw new Error("Invalid live word order or clock.");
      end = word.end;
    }
    if (!this.connected || generation !== this.generation) return false;
    const previous = this.segments.get(segment.id);
    if (previous && (previous.final || previous.revision >= segment.revision)) return false;
    this.segments.set(segment.id, structuredClone(segment));
    if (this.segments.size > 200) {
      const oldest = this.segments.keys().next().value;
      if (oldest) this.segments.delete(oldest);
    }
    this.latency = segment.words.length ? Math.max(0, receivedAt - end) : null;
    return true;
  }
  status() {
    return { connected: this.connected, generation: this.generation, latencySeconds: this.latency };
  }
  words(target: CaptionTarget): TranscriptWord[] {
    if (!this.targets.has(target)) return [];
    return structuredClone([...this.segments.values()].flatMap((segment) => segment.words)).sort(
      (a, b) => a.start - b.start || a.end - b.end,
    );
  }
  text(target: CaptionTarget, time: number) {
    if (!Number.isFinite(time) || time < 0) throw new Error("Invalid caption time.");
    return this.words(target)
      .filter((word) => word.start <= time && time < word.end + 1.5)
      .map((word) => word.text)
      .join(" ")
      .slice(-500);
  }
}
