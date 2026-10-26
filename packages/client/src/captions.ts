import { Schema } from "effect";
import type { ProjectView } from "./project-view";
import { cmd, type Command } from "./commands";

const TextSchema = Schema.Struct({
  text: Schema.String,
  words: Schema.optionalKey(
    Schema.Array(
      Schema.StructWithRest(
        Schema.Struct({ text: Schema.String, start: Schema.Finite, end: Schema.Finite }),
        [Schema.Record(Schema.String, Schema.Unknown)],
      ),
    ),
  ),
});
/** Patch each caption's text, optional timed words, and name as one proposed batch. */
export function fixCaptionWords(project: ProjectView, fixes: Record<string, string>) {
  const rules = Object.entries(fixes).map(([from, to]) => ({
    from: from.trim().toLowerCase().split(/\s+/),
    to,
  }));
  if (rules.some((rule) => !rule.from[0] || !rule.to.trim()))
    throw new Error("Caption replacements need nonempty phrases.");
  const bare = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
  const commands: Command[] = [],
    changes: { clipID: string; before: string; after: string }[] = [];
  for (const clip of project.captions()) {
    const content = Schema.decodeUnknownSync(TextSchema)(clip.content.text);
    const timed = content.words?.length ? content.words : undefined;
    const words: { text: string; start?: number; end?: number }[] = timed
      ? timed.map((word) => ({ ...word }))
      : content.text
          .split(/\s+/)
          .filter(Boolean)
          .map((text) => ({ text }));
    const output: typeof words = [];
    for (let index = 0; index < words.length;) {
      const first = words[index]!;
      const rule = rules.find((item) =>
        item.from.every(
          (part, offset) => words[index + offset] && bare(words[index + offset]!.text) === part,
        ),
      );
      if (!rule) {
        output.push(first);
        index++;
        continue;
      }
      const last = words[index + rule.from.length - 1]!;
      const prefix = first.text.match(/^[^\p{L}\p{N}]*/u)?.[0] ?? "";
      const suffix = last.text.match(/[^\p{L}\p{N}]*$/u)?.[0] ?? "";
      output.push({
        ...first,
        ...(last.end == null ? {} : { end: last.end }),
        text: prefix + rule.to + suffix,
      });
      index += rule.from.length;
    }
    const text = output.map((word) => word.text).join(" ");
    if (text === content.text) continue;
    changes.push({ clipID: clip.id, before: content.text, after: text });
    commands.push(
      cmd.updateClip({
        clipID: clip.id,
        patch: {
          name: text,
          content: { text: { text, ...(timed ? { words: output } : {}) } },
        },
      }),
    );
  }
  return { commands, changes };
}
