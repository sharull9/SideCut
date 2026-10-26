// CLI/ReadableText/Archive/Relink/Check source at Tandem 735a9b8. TANDEM-LICENSE applies.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { clock, parseCommandTime } from "./cli-query-commands.mjs";

export function prepareResourceCommand(parsed) {
  const offset = parsed.words[0] === "project" ? 1 : 0,
    operation = parsed.words[offset];
  if (!["watch", "effects", "archive", "relink", "check"].includes(operation)) return undefined;
  const flags = new Map(parsed.flags),
    positional = parsed.words.slice(offset + 1),
    allowed = {
      watch: ["once", "follow", "timeout", "revision", "generation"],
      effects: ["type"],
      archive: ["to", "with-cache", "dry-run", "label", "output"],
      relink: ["search", "dry-run", "label", "expected-revision", "media-id", "path"],
      check: ["from", "to", "changed", "quick", "cuts", "width"],
    }[operation];
  for (const key of flags.keys())
    if (
      !["project", "author", "endpoint-file", "input", "request", "json", ...allowed].includes(key)
    )
      throw new Error(`Unknown ${operation} option --${key}.`);
  if (operation === "effects" && positional.length === 1) {
    if (flags.has("type")) throw new Error("Duplicate effect type.");
    flags.set("type", positional[0]);
  } else if (operation === "archive" && positional.length === 1) {
    if (flags.has("project")) throw new Error("Duplicate archive project.");
    flags.set("project", positional[0]);
  } else if (positional.length) throw new Error(`${operation} got unexpected arguments.`);
  if (
    operation === "archive" &&
    flags.has("with-cache") &&
    !flags.has("to") &&
    !flags.has("request") &&
    !flags.has("input")
  )
    throw new Error("--with-cache requires --to.");
  if (operation === "check" && flags.has("quick") && flags.has("cuts"))
    throw new Error("Choose --quick or --cuts.");
  if (operation === "watch") {
    if (flags.has("once") && flags.has("follow")) throw new Error("Choose --once or --follow.");
    if (!flags.has("once")) flags.set("follow", true);
    flags.delete("once");
  }
  if (!["archive", "relink"].includes(operation)) flags.delete("author");
  const follow = operation === "watch" && flags.has("follow"),
    json = flags.has("json");
  return {
    flags,
    words: parsed.words.slice(0, offset + 1),
    ...(operation === "effects"
      ? {
          offline: async () => {
            if (flags.has("input") && flags.has("request"))
              throw new Error("Choose --request or --input.");
            const raw = flags.has("input")
              ? JSON.parse(await readFile(String(flags.get("input")), "utf8"))
              : flags.has("request")
                ? JSON.parse(String(flags.get("request")))
                : {};
            const input = z.object({ type: z.string().optional() }).strict().parse(raw);
            if (flags.has("type")) {
              if (input.type != null) throw new Error("Duplicate effect type.");
              input.type = String(flags.get("type"));
            }
            const result = JSON.parse(
              await readFile(new URL("./effects-catalog.json", import.meta.url), "utf8"),
            );
            if (input.type != null)
              result.effects = result.effects.filter(
                (e) => e.type.toLowerCase() === input.type.toLowerCase(),
              );
            if (!result.effects.length) {
              const error = new Error("Unknown effect type.");
              error.exitCode = 5;
              throw error;
            }
            return result;
          },
        }
      : {}),
    prepare(input) {
      input = { ...input };
      const legacyRelink = operation === "relink" && (input.mediaID != null || input.path != null);
      if (["archive", "relink"].includes(operation) && !legacyRelink && input.author == null)
        input.author = process.env.SIDECUT_AUTHOR ?? process.env.TANDEM_AUTHOR ?? "cli";
      if (operation === "archive" && input.withCache && input.to == null)
        throw new Error("--with-cache requires --to.");
      if (operation === "check") {
        if (input.quick && input.cuts) throw new Error("Choose --quick or --cuts.");
        for (const key of ["from", "to"])
          if (input[key] != null) input[key] = parseCommandTime(input[key]);
      }
      if (follow && !json) process.stderr.write("Watching the project. Stop with Ctrl-C.\n");
      return input;
    },
    text: follow
      ? (r) =>
          r.changed
            ? (r.events?.length ? r.events : [{ kind: "resync", revision: r.revision }])
                .map((e) =>
                  json
                    ? JSON.stringify(e)
                    : `${e.date ? new Date(e.date).toTimeString().slice(0, 8) : "--:--:--"}  r${e.revision ?? 0}  ${e.kind}  ${e.label ?? ""}  (${e.author ?? "?"})`,
                )
                .join("\n")
            : ""
      : json
        ? undefined
        : (r) => resourceText(operation, r),
  };
}
const number = (v) => Number(Number(v).toPrecision(6)).toString();
const duration = (v) => (Math.abs(v) < 60 ? `${Number(v).toFixed(3)}s` : clock(v));
const home = (p) =>
  String(p).startsWith(homedir() + "/") ? "~" + String(p).slice(homedir().length) : p;
const size = (b) => {
  const i = Math.min(3, Math.max(0, Math.floor(Math.log10(Math.max(1000, b)) / 3) - 1));
  return `${Number((b / 1000 ** (i + 1)).toFixed(1))} ${["KB", "MB", "GB", "TB"][i]}`;
};
export function resourceText(operation, r) {
  if (operation === "watch")
    return r.changed
      ? [
          `Changed. Now at revision ${r.revision}.`,
          ...(r.events.length
            ? r.events.map(
                (e) => `  r${e.revision ?? 0}  ${e.kind}  ${e.label ?? ""}  (${e.author ?? "?"})`,
              )
            : ["  (made by another process; read the timeline to see what changed)"]),
        ].join("\n")
      : `No change. Still at revision ${r.revision}.`;
  if (operation === "effects") {
    const value = (v) =>
      typeof v === "string"
        ? JSON.stringify(v)
        : typeof v === "number"
          ? number(v)
          : typeof v === "boolean"
            ? String(v)
            : v?.x != null
              ? `(${v.x}, ${v.y})`
              : v?.r != null
                ? "#" +
                  [v.r, v.g, v.b]
                    .map((c) =>
                      Math.round(c * 255)
                        .toString(16)
                        .padStart(2, "0"),
                    )
                    .join("")
                : JSON.stringify(v);
    const lines = ['Effects (addEffect {"type": ..., "params": {...}}):'];
    for (const effect of r.effects) {
      lines.push(`  ${effect.type}  ${effect.domain}  ${effect.summary}`);
      for (const p of effect.params)
        lines.push(
          `    ${p.key}: ${p.kind}${p.min != null && p.max != null ? ` ${number(p.min)}...${number(p.max)}` : ""}${p.unit ? ` ${p.unit}` : ""}, default ${value(p.defaultValue)}`,
        );
    }
    lines.push(
      "Transitions: " +
        r.transitions.map((t) => `${t.type} (${duration(t.defaultDuration)})`).join(", "),
      "Layouts (applyLayout): " + r.layouts.map((l) => `${l.preset} (${l.name})`).join(", "),
      "Animatable parameters (setKeyframes): " + r.animatable.join(", "),
    );
    return lines.join("\n");
  }
  if (operation === "relink") {
    const total = r.relinked.length + r.missing.length,
      lines = [];
    if (!total) return "Nothing's missing: every media file is where the project says.";
    if (!r.relinked.length)
      lines.push(`Found none of the ${total} missing file${total === 1 ? "" : "s"}.`);
    else {
      lines.push(
        `${r.dryRun ? "Would relink" : r.applied ? "Relinked" : "Found"} ${r.relinked.length} of ${total} missing file${total === 1 ? "" : "s"}${r.applied ? ` as revision ${r.applied.revision}` : ""}:`,
      );
      for (const item of r.relinked) lines.push(`  ${item.mediaID}  ${item.from} -> ${item.to}`);
    }
    if (r.missing.length) {
      lines.push(`Still missing (${r.missing.length}):`);
      for (const item of r.missing)
        lines.push(
          `  ${item.mediaID}  ${item.path}  (${item.clips} clip${item.clips === 1 ? "" : "s"})${item.ambiguous ? "; several files have that name, so pick the right one's folder with --search" : ""}`,
        );
    }
    lines.push(`Searched: ${r.searched.map(home).join(", ")}.`);
    if (r.dryRun && r.relinked.length)
      lines.push("Nothing changed yet. Run it without --dry-run to relink them.");
    if (r.missing.length)
      lines.push('Add a folder to look in with --search <folder> (MCP and HTTP: search: ["..."]).');
    return lines.join("\n");
  }
  if (operation === "check") {
    if (!r.ranges.length) return r.note ?? "Nothing to check.";
    const scanned =
      r.cuts != null
        ? `${r.cuts} cut edge${r.cuts === 1 ? "" : "s"}`
        : r.frames > 0
          ? `${r.frames} frames`
          : "quick: no frames rendered";
    const lines = [
      `Checked ${r.ranges.map((p) => `${clock(p.start)}-${clock(p.end ?? p.start + p.duration)}`).join(", ")} (${scanned}) in ${Number(r.seconds).toFixed(1)} s: ${r.problems.length ? `${r.problems.length} problem${r.problems.length === 1 ? "" : "s"}:` : "no problems."}`,
    ];
    const line = (p) =>
      `  ${clock(p.start)}${p.end === p.start ? "" : `-${clock(p.end)}`}  ${p.message}${
        p.clipIDs?.length
          ? "  On: " +
            p.clipIDs
              .slice(0, 3)
              .map((id) => (r.clipNames?.[id] ? `${id} ${r.clipNames[id]}` : id))
              .join(", ")
          : ""
      }`;
    lines.push(...r.problems.map(line));
    if (r.notes?.length) lines.push("Notes (not problems):", ...r.notes.map(line));
    lines.push(...(r.warnings ?? []).map((w) => `Warning: ${w}`));
    if (r.commands?.length)
      lines.push(
        `Fix: sidecut apply${r.revision != null ? ` --expect ${r.revision}` : ""} --label "${r.cuts == null ? "Hold the frame before each flicker" : "Move clipped cuts into pauses"}" '${JSON.stringify(r.commands)}'`,
      );
    return lines.join("\n");
  }
  if (r.mode == null) return `Wrote ${r.path} (${r.bytes} bytes).`;
  const name = basename(r.project),
    files = (n) => `${n} file${n === 1 ? "" : "s"}`,
    collected = r.collected ?? [],
    bytes = collected.filter((f) => f.outcome !== "reused").reduce((sum, f) => sum + f.bytes, 0),
    nothing = !collected.length && !r.madeRelative,
    lines = [];
  if (r.mode === "consolidate" && nothing)
    lines.push(
      `${name} is ${r.dryRun ? "" : "now "}standalone: every file it uses is in its folder, ${r.folder}.`,
    );
  else if (r.mode === "consolidate")
    lines.push(
      r.dryRun
        ? `Dry run, nothing changed. Making ${name} standalone would bring in ${files(collected.length)} from outside its folder (${size(bytes)}).`
        : `${name} is standalone: brought in ${files(collected.length)} from outside its folder (${size(bytes)}${r.reusedFiles ? `; ${r.reusedFiles} were already there` : ""}).`,
    );
  else
    lines.push(
      r.dryRun
        ? `Dry run, nothing changed. Archiving ${name} would write a standalone copy to ${r.folder}: the project folder (${files(r.folderFiles)}, ${size(r.folderBytes)}) and ${files(collected.length)} from outside it (${size(bytes)}).`
        : `Archived ${name} to ${r.folder}, a standalone copy; the original is as it was. Copied ${files(r.copiedFiles)} (${size(r.copiedBytes)})${r.reusedFiles ? `; ${r.reusedFiles} were already there` : ""}.`,
    );
  if (r.mode === "archive" && r.folderParts?.length) {
    lines.push(`The project folder${r.dryRun ? "" : "'s files"}:`);
    const width = Math.min(40, Math.max(...r.folderParts.map((p) => p.path.length)));
    for (const p of r.folderParts)
      lines.push(`  ${p.path.padEnd(width)}  ${files(p.files)}, ${size(p.bytes)}`);
  }
  if (collected.length) {
    lines.push(r.dryRun ? "From outside the folder:" : "Brought in:");
    for (const f of collected.slice(0, 40))
      lines.push(
        `  ${f.path}  ${size(f.bytes)}${f.outcome === "planned" ? "" : `  ${f.outcome}`}  from ${home(f.original)}`,
      );
    if (collected.length > 40)
      lines.push(`  ... and ${collected.length - 40} more (--json lists them all)`);
  }
  if (r.madeRelative)
    lines.push(
      `${r.madeRelative} path${r.madeRelative === 1 ? "" : "s"} inside the folder ${r.dryRun ? "would be" : "were"} made relative.`,
    );
  const fonts = (r.fonts ?? [])
    .filter((f) => f.status === "collected")
    .map((f) => `${f.family} (from ${f.files.map(home).join(", ")})`);
  if (fonts.length) lines.push(`Fonts copied into assets/font: ${fonts.join("; ")}.`);
  if (r.missing?.length) {
    lines.push(`Missing, so left as they are (${r.missing.length}):`);
    for (const m of r.missing)
      lines.push(
        m.kind === "font"
          ? `  font "${m.path}" isn't installed here; ${m.clips} title${m.clips === 1 ? "" : "s"} use it and fall back.`
          : `  ${m.path}  (${m.usedBy.join(", ")}${m.clips > 0 ? `, ${m.clips} clip${m.clips === 1 ? "" : "s"}` : ""})`,
      );
  }
  for (const p of r.leftOut ?? [])
    lines.push(`Left out ${p.path}${p.bytes > 0 ? ` (${size(p.bytes)})` : ""}: ${p.why}`);
  for (const other of r.otherProjects ?? [])
    if (other.note) lines.push(`${other.file}: ${other.note}`);
    else if (other.rewritten > 0)
      lines.push(
        `${other.file}: ${other.rewritten} path${other.rewritten === 1 ? "" : "s"} pointed at the copies too.`,
      );
  lines.push(...(r.warnings ?? []).map((w) => `Warning: ${w}`));
  if (r.dryRun) {
    if (r.mode === "archive")
      lines.push("Run it without --dry-run (dryRun: false) to write the archive.");
    else if (!nothing)
      lines.push(
        "Run it without --dry-run (dryRun: false) to copy them in, or pass --to <folder> to write a standalone copy somewhere else instead.",
      );
  } else {
    if (r.revision != null && r.mode === "consolidate" && !nothing)
      lines.push(
        `The project is at revision ${r.revision}; \`sidecut undo\` points it back at the old paths (the copies stay).`,
      );
    if (r.manifest) lines.push(`Manifest: ${r.manifest}`);
  }
  return lines.join("\n");
}
