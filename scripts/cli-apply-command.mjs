// TandemCLI/CLI.swift and TandemAPI/ReadableText.swift at 735a9b8.
// Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { z } from "zod";
import { clock } from "./cli-query-commands.mjs";

export async function prepareApplyCommand(parsed) {
  const offset = parsed.words[0] === "project" ? 1 : 0;
  if (parsed.words[offset] !== "apply") return undefined;
  const flags = new Map(parsed.flags),
    positional = parsed.words.slice(offset + 1);
  if (positional.length > 1) throw new Error("apply takes at most one JSON source.");
  for (const key of flags.keys())
    if (
      ![
        "project",
        "endpoint-file",
        "json",
        "input",
        "request",
        "commands",
        "label",
        "author",
        "expected-revision",
        "key",
        "idempotency-key",
        "dry-run",
      ].includes(key)
    )
      throw new Error(`Unknown apply option --${key}.`);
  if (flags.has("key")) {
    if (flags.has("idempotency-key")) throw new Error("Choose --key or --idempotency-key.");
    flags.set("idempotency-key", flags.get("key"));
    flags.delete("key");
  }
  if (
    Number(positional.length > 0) +
      Number(flags.has("input")) +
      Number(flags.has("request")) +
      Number(flags.has("commands")) !==
    1
  )
    throw new Error(
      "apply needs one JSON source: a file, inline JSON, -, --input, --request or --commands.",
    );
  if (!flags.has("commands")) {
    const source = positional[0],
      raw =
        source === "-"
          ? await text(process.stdin)
          : source != null
            ? /^\s*[[{]/.test(source)
              ? source
              : await readFile(source, "utf8")
            : flags.has("input")
              ? await readFile(String(flags.get("input")), "utf8")
              : String(flags.get("request")),
      value = JSON.parse(raw),
      parsedValue = z
        .union([z.array(z.unknown()), z.record(z.string(), z.unknown())])
        .safeParse(value);
    if (!parsedValue.success)
      throw new Error("Expected a batch object, a list of commands or one command.");
    const batch = Array.isArray(value)
      ? { commands: value }
      : Object.hasOwn(value, "commands")
        ? value
        : { commands: [value] };
    // Native flags override fields from the JSON batch.
    for (const [flag, field] of [
      ["label", "label"],
      ["author", "author"],
      ["expected-revision", "expectedRevision"],
      ["idempotency-key", "idempotencyKey"],
      ["dry-run", "dryRun"],
    ])
      if (flags.has(flag)) delete batch[field];
    flags.delete("input");
    flags.set("request", JSON.stringify(batch));
  }
  return {
    flags,
    words: parsed.words.slice(0, offset + 1),
    prepare(input) {
      if (input.author == null)
        input.author = process.env.SIDECUT_AUTHOR ?? process.env.TANDEM_AUTHOR ?? "cli";
      return input;
    },
    text: flags.has("json") ? undefined : applyText,
  };
}

export function applyText(r) {
  const lines = [
    r.dryRun
      ? `Dry run of "${r.label}" at revision ${r.revision}: it would work.`
      : r.repeated
        ? `Already applied "${r.label}" (same idempotency key) as revision ${r.revision}. Nothing changed.`
        : `Applied "${r.label}" by ${r.author} as revision ${r.revision}.`,
  ];
  if (r.createdIDs.length)
    lines.push(
      `Created: ${r.createdIDs.slice(0, 12).join(", ")}${r.createdIDs.length > 12 ? `, and ${r.createdIDs.length - 12} more (--json lists them all)` : ""}`,
    );
  const changes = [];
  if (r.added.length)
    changes.push(`${r.added.length} clip${r.added.length === 1 ? "" : "s"} added`);
  if (r.removed.length) changes.push(`${r.removed.length} removed (${r.removed.join(", ")})`);
  if (r.changed.length) changes.push(`${r.changed.length} changed`);
  if (changes.length) lines.push(`${changes.join(", ")}. Timeline is ${clock(r.duration)} long.`);
  for (const warning of r.warnings) lines.push(`Warning: ${warning}`);
  return lines.join("\n");
}
