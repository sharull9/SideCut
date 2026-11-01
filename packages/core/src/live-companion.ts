import { Schema } from "effect";

const profileSchema = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(60)),
  avatar: Schema.Literals(["orb", "robot", "cat"]),
  color: Schema.String.check(Schema.isPattern(/^#[0-9a-f]{6}$/i)),
  animated: Schema.Boolean,
});
const savedSchema = Schema.Struct({
  version: Schema.Literals([1]),
  profiles: Schema.Array(profileSchema),
});
export type CompanionProfile = typeof profileSchema.Type;

/** Procedural avatars are SideCut-owned; restoring a library never activates it. */
export class LiveCompanion {
  private profiles = new Map<string, CompanionProfile>();
  private active: string | null = null;
  private reaction: { kind: "happy" | "surprised"; start: number } | null = null;
  save(input: unknown) {
    const profile = Schema.decodeUnknownSync(profileSchema)(input);
    if (!profile.name.trim() || (!this.profiles.has(profile.id) && this.profiles.size >= 20))
      throw new Error("Use up to 20 named companion profiles.");
    this.profiles.set(profile.id, structuredClone(profile));
  }
  list() {
    return structuredClone([...this.profiles.values()]);
  }
  activate(id: string) {
    if (!this.profiles.has(id)) throw new Error("Companion profile unavailable.");
    this.active = id;
    this.reaction = null;
  }
  deactivate() {
    this.active = null;
    this.reaction = null;
  }
  remove(id: string) {
    if (this.active === id) this.deactivate();
    this.profiles.delete(id);
  }
  react(kind: "happy" | "surprised", time: number) {
    if (!Number.isFinite(time) || time < 0) throw new Error("Invalid companion time.");
    if (!this.active) throw new Error("Activate the companion first.");
    this.reaction = { kind, start: time };
  }
  frame(time: number, reducedMotion = false) {
    if (!Number.isFinite(time) || time < 0) throw new Error("Invalid companion time.");
    const profile = this.active ? this.profiles.get(this.active) : undefined;
    if (!profile) return null;
    const elapsed = this.reaction ? time - this.reaction.start : -1;
    const reaction = elapsed >= 0 && elapsed < 2 ? (this.reaction?.kind ?? null) : null;
    const scale =
      reaction && profile.animated && !reducedMotion && elapsed < 0.25
        ? 1 + 0.08 * Math.sin((Math.PI * elapsed) / 0.25)
        : 1;
    return { profile: structuredClone(profile), reaction, scale };
  }
  serialize() {
    return JSON.stringify({ version: 1, profiles: this.list() });
  }
  static restore(encoded: string) {
    if (encoded.length > 20000) throw new Error("Companion library exceeds 20 KB.");
    const saved = Schema.decodeUnknownSync(savedSchema)(JSON.parse(encoded));
    if (
      saved.profiles.length > 20 ||
      new Set(saved.profiles.map((p) => p.id)).size !== saved.profiles.length
    )
      throw new Error("Invalid companion library.");
    const library = new LiveCompanion();
    for (const profile of saved.profiles) library.save(profile);
    return library;
  }
}
