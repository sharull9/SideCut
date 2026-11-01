import { Schema } from "effect";

const kinds = ["welcome", "question", "flag", "promise", "command", "clip", "report"] as const;
const eventSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  kind: Schema.Literals(kinds),
  author: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  authorID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  text: Schema.String.check(Schema.isMaxLength(2000)),
  time: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
});
type Kind = typeof eventSchema.Type.kind;
type Proposal = typeof eventSchema.Type & {
  draft: string;
  state: "suggested" | "posting" | "posted" | "failed";
};
export type CompanionPoster = (
  text: string,
  options: { idempotencyKey: string; signal: AbortSignal },
) => Promise<void>;

/** Incoming chat can propose plain text only; it cannot invoke tools or edit a project. */
export class CompanionBehavior {
  private consent = false;
  private suggestOnly = true;
  private enabled = new Set<Kind>(kinds);
  private seen = new Set<string>();
  private welcomed = new Set<string>();
  private proposals = new Map<string, Proposal>();
  private controller = new AbortController();
  private posting = false;
  private lastPost = -Infinity;
  private lastClock = -Infinity;
  private welcome = "Welcome, {author}!";

  configure(options: {
    consent: boolean;
    suggestOnly: boolean;
    enabled: readonly Kind[];
    welcome?: string;
  }) {
    if (options.welcome !== undefined && (!options.welcome.trim() || options.welcome.length > 300))
      throw new Error("Welcome template needs 1–300 characters.");
    this.controller.abort();
    this.controller = new AbortController();
    this.consent = options.consent;
    this.suggestOnly = options.suggestOnly;
    this.enabled = new Set(options.enabled);
    if (options.welcome !== undefined) this.welcome = options.welcome;
    if (!this.consent) this.proposals.clear();
  }
  receive(input: unknown) {
    const event = Schema.decodeUnknownSync(eventSchema)(input);
    if (!this.consent || !this.enabled.has(event.kind) || this.seen.has(event.id)) return false;
    if (event.kind === "welcome" && this.welcomed.has(event.authorID)) return false;
    this.seen.add(event.id);
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value!);
    if (event.kind === "welcome") {
      // Keep welcomes once per session; require a fresh session after the bounded audience fills.
      if (this.welcomed.size >= 1000) return false;
      this.welcomed.add(event.authorID);
    }
    const draft =
      event.kind === "welcome"
        ? this.welcome.replaceAll("{author}", event.author)
        : event.kind === "question"
          ? `Question from ${event.author}: ${event.text}`
          : event.kind === "clip"
            ? `Review a clip near ${event.time.toFixed(1)}s: ${event.text}`
            : event.kind === "command"
              ? `Command suggestion: ${event.text}`
              : event.text;
    this.proposals.set(event.id, { ...event, draft: draft.slice(0, 2000), state: "suggested" });
    if (this.proposals.size > 200) {
      const oldest = [...this.proposals].find(([, item]) => item.state !== "posting");
      if (oldest) this.proposals.delete(oldest[0]);
    }
    return true;
  }
  list() {
    return structuredClone([...this.proposals.values()]);
  }
  edit(id: string, draft: string) {
    const proposal = this.proposals.get(id);
    if (!proposal || proposal.state !== "suggested" || !draft.trim() || draft.length > 2000)
      throw new Error("Draft is unavailable or invalid.");
    proposal.draft = draft;
  }
  async post(id: string, now: number, poster: CompanionPoster) {
    if (!Number.isFinite(now) || now < this.lastClock || now < 0)
      throw new Error("Invalid posting clock.");
    this.lastClock = now;
    const proposal = this.proposals.get(id);
    if (
      !this.consent ||
      this.suggestOnly ||
      !proposal ||
      !this.enabled.has(proposal.kind) ||
      proposal.state !== "suggested"
    )
      throw new Error("Posting requires an enabled, explicitly reviewed suggestion.");
    if (!["welcome", "question"].includes(proposal.kind))
      throw new Error("This suggestion is local only.");
    if (this.posting || now - this.lastPost < 5) throw new Error("Companion posting rate limit.");
    this.posting = true;
    this.lastPost = now;
    proposal.state = "posting";
    const signal = this.controller.signal;
    try {
      await poster(proposal.draft, { idempotencyKey: id, signal });
      if (signal.aborted) throw new Error("Posting consent changed.");
      proposal.state = "posted";
    } catch {
      // Ambiguous network delivery is never retried automatically; adapters must deduplicate IDs.
      proposal.state = "failed";
      throw new Error(
        "Posting did not complete; verify provider delivery before creating another suggestion.",
      );
    } finally {
      this.posting = false;
    }
  }
  report() {
    return this.list().map(({ kind, author, text, time, state }) => ({
      kind,
      author,
      text,
      time,
      state,
    }));
  }
}
