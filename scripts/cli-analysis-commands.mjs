// Tandem CLI/Comments/Sync/Wait/Diff at 735a9b8. See TANDEM-LICENSE.
import { clock, parseCommandTime } from "./cli-query-commands.mjs";
import { applyText } from "./cli-apply-command.mjs";
const commands = new Set(["comments", "sync", "wait", "transcribe", "diff", "restore", "clips"]);
const delay = (value) => {
  if (typeof value !== "string" || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:ms|s)?$/.test(value.trim()))
    return undefined;
  const text = value.trim(),
    number = Number(text.replace(/(?:ms|s)$/, "")) / (text.endsWith("ms") ? 1000 : 1);
  return Number.isFinite(number) ? number : undefined;
};
export function prepareAnalysisCommand(parsed) {
  const offset = parsed.words[0] === "project" ? 1 : 0,
    operation = parsed.words[offset];
  if (!commands.has(operation)) return undefined;
  const flags = new Map(parsed.flags),
    positional = parsed.words.slice(offset + 1),
    allowed = {
      comments: ["all", "label", "expected-revision"],
      sync: [
        "delay",
        "media",
        "default",
        "make-default",
        "files",
        "to",
        "place",
        "no-place",
        "dry-run",
        "label",
        "expected-revision",
      ],
      wait: ["what", "media", "timeout"],
      transcribe: ["media", "wait", "no-wait", "timeout", "label"],
      diff: ["since"],
      restore: [
        "from",
        "clips",
        "from-time",
        "to-time",
        "track",
        "apply",
        "label",
        "expected-revision",
      ],
      clips: ["track", "from", "to", "media", "ids"],
    }[operation];
  for (const key of flags.keys())
    if (
      !["project", "author", "endpoint-file", "input", "request", "json", ...allowed].includes(key)
    )
      throw new Error(`Unknown ${operation} option --${key}.`);
  let execute,
    textOperation = operation;
  if (operation === "comments" && positional[0] === "resolve") {
    const ids = positional.slice(1),
      all = flags.has("all"),
      label = flags.get("label"),
      author =
        flags.get("author") ?? process.env.SIDECUT_AUTHOR ?? process.env.TANDEM_AUTHOR ?? "cli",
      expected = flags.get("expected-revision");
    if (all === Boolean(ids.length)) throw new Error("Give comment IDs or --all, not both.");
    if (flags.has("input") || flags.has("request"))
      throw new Error("Comment resolution takes IDs or --all.");
    textOperation = "apply";
    execute = async (call) => {
      const listed = await call("comments", {});
      if (!listed) return null;
      const known = new Set(listed.comments.map((c) => c.id));
      for (const id of ids) if (!known.has(id)) throw new Error(`${id} isn't a listed comment.`);
      const chosen = all ? listed.comments.map((c) => c.id) : ids;
      if (!chosen.length) return "No comments to resolve.";
      return call("apply", {
        label: label ?? `Resolve comment${chosen.length === 1 ? "" : "s"}`,
        author,
        expectedRevision: expected == null ? listed.revision : Number(expected),
        commands: chosen.map((id) => ({ removeMarker: { markerID: id } })),
      });
    };
  } else if (operation === "sync" && positional.length) {
    const picture = positional.length === 1 ? delay(positional[0]) : undefined;
    if (positional.length > 1 || (picture == null && /^med_|[\\/.]/.test(positional[0]))) {
      if (flags.has("files")) throw new Error("Duplicate sync files.");
      flags.set("files", JSON.stringify(positional));
    } else {
      if (picture == null)
        throw new Error("Give a picture delay in seconds or milliseconds, or file paths.");
      if (flags.has("delay")) throw new Error("Duplicate sync delay.");
      flags.set("delay", String(picture));
    }
  } else if (operation === "wait" && positional.length === 1) {
    if (flags.has("what")) throw new Error("Duplicate wait target.");
    flags.set("what", positional[0]);
  } else if (operation === "transcribe" && positional.length) {
    if (flags.has("media")) throw new Error("Duplicate transcription media.");
    flags.set("media", JSON.stringify(positional));
  } else if (operation === "diff" && positional.length === 1) {
    if (flags.has("since")) throw new Error("Duplicate diff baseline.");
    flags.set("since", positional[0]);
  } else if (positional.length) throw new Error(`${operation} got unexpected arguments.`);
  const sourced = flags.has("input") || flags.has("request");
  if (operation === "comments" && !execute && flags.has("all"))
    throw new Error("--all requires comments resolve.");
  if (
    operation === "wait" &&
    flags.has("what") &&
    !["jobs", "export", "transcript", "matte", "proxy"].includes(flags.get("what"))
  )
    throw new Error("Unknown wait target.");
  if (operation === "transcribe") {
    if (flags.has("wait") && flags.has("no-wait")) throw new Error("Choose --wait or --no-wait.");
    if (!flags.has("media") && !sourced)
      throw new Error("transcribe needs media IDs, clips or paths.");
    if (flags.has("no-wait")) {
      flags.delete("no-wait");
      flags.set("wait", "false");
    }
  }
  if (operation === "diff" && !flags.has("since") && !sourced)
    throw new Error("diff needs --since or a positional baseline.");
  if (operation === "restore" && !flags.has("from") && !sourced)
    throw new Error("restore needs --from.");
  if (operation === "sync")
    for (const [source, target] of [
      ["default", "make-default"],
      ["no-place", "place"],
    ]) {
      if (!flags.has(source)) continue;
      if (flags.has(target)) throw new Error(`Choose --${source} or --${target}.`);
      flags.set(target, source === "default" ? true : "false");
      flags.delete(source);
    }
  if (operation === "clips" && flags.has("media")) {
    const media = flags.get("media");
    if (Array.isArray(media)) {
      if (media.length !== 1) throw new Error("clips takes one media selector.");
      flags.set("media", media[0]);
    }
  }
  if (!["sync", "restore", "transcribe"].includes(operation)) flags.delete("author");
  return {
    flags,
    words: parsed.words.slice(0, offset + 1),
    ...(execute ? { execute } : {}),
    prepare(input) {
      input = { ...input };
      if (["sync", "restore", "transcribe"].includes(operation) && input.author == null)
        input.author = process.env.SIDECUT_AUTHOR ?? process.env.TANDEM_AUTHOR ?? "cli";
      if (operation === "restore" && input.apply == null) input.apply = false;
      if (operation === "transcribe" && input.wait == null) input.wait = false;
      if (operation === "wait" && input.what == null) input.what = "jobs";
      if (operation === "clips" && Array.isArray(input.media)) {
        if (input.media.length !== 1) throw new Error("clips takes one media selector.");
        input.media = input.media[0];
      }
      for (const key of ["from-time", "to-time"])
        if (flags.has(key)) parseCommandTime(flags.get(key));
      return input;
    },
    text: flags.has("json")
      ? undefined
      : (r) => (textOperation === "apply" ? applyText(r) : analysisText(operation, r)),
  };
}
const state = (item) =>
  item.state === "ready"
    ? item.words == null
      ? "ready"
      : item.words === 0
        ? "ready, no speech"
        : `ready, ${item.words} word${item.words === 1 ? "" : "s"}`
    : item.state === "running"
      ? `running${item.progress == null ? "" : ` ${Math.floor(item.progress * 100)}%`}`
      : item.state === "waiting"
        ? "waiting to start"
        : item.state === "failed"
          ? `failed${item.message ? `: ${item.message}` : ""}`
          : item.state;
const ms = (v) => `${Math.sign(v) * Math.round(Math.abs(v) * 1000)} ms`;
export function analysisText(operation, r) {
  if (operation === "comments") {
    if (!r.comments.length) return `No comments (revision ${r.revision}).`;
    const width = Math.max(0, ...r.comments.flatMap((c) => c.clips).map((c) => c.track.length)),
      lines = [
        `${r.comments.length} comment${r.comments.length === 1 ? "" : "s"} from the editor, earliest first (revision ${r.revision}):`,
      ];
    for (const c of r.comments) {
      lines.push("", `${c.id}  ${clock(c.time)}  "${c.text.replace(/\s+/g, " ").trim()}"`);
      if (c.said) lines.push(`  said: ${c.said}`);
      for (const clip of c.clips)
        lines.push(
          `  ${clip.track.padEnd(width)}  ${clip.clipID}  ${clock(clip.start)}-${clock(clip.end)}  ${clip.content}`,
        );
    }
    lines.push(
      "",
      'Do what each asks and label the edit with what you did. Remove the comment in the same apply batch, {"removeMarker": {"markerID": "<id>"}}, or afterwards with sidecut comments resolve <id>. Comments move with ripple edits, so read them again after one.',
    );
    return lines.join("\n");
  }
  if (operation === "sync") {
    const lines = [];
    if (r.matches) {
      lines.push(
        `Lined up with ${r.reference ?? "the camera"} by sound (how much further into each file the same moment is):`,
      );
      const width = Math.max(0, ...r.matches.map((m) => m.id.length));
      for (const m of r.matches) {
        let line = `  ${m.id.padEnd(width)}  ${m.path}  ${m.offset < 0 ? "" : "+"}${Number(m.offset).toFixed(3)} s`;
        if (m.drift != null)
          line += `, drift ${ms(m.drift)} over ${m.overlapEnd - m.overlapStart < 60 ? `${Number(m.overlapEnd - m.overlapStart).toFixed(3)}s` : clock(m.overlapEnd - m.overlapStart)}`;
        line += `, confidence ${Number(m.confidence).toFixed(0)}.`;
        if (m.tracks?.length)
          line += ` On ${m.tracks.map((t) => JSON.stringify(t)).join(" and ")}.`;
        lines.push(line, ...(m.notes ?? []).map((n) => `    ${n}`));
      }
      if (r.applied) {
        lines.push(
          r.applied.dryRun
            ? `Dry run: nothing changed. Without --dry-run it sets their takes${r.applied.added.length ? " and places them" : ""} as one undo step.`
            : `Applied "${r.applied.label}" by ${r.applied.author} as revision ${r.applied.revision}.`,
        );
        lines.push(...r.applied.warnings.map((w) => `Warning: ${w}`));
      }
      return lines.join("\n");
    }
    if (r.applied)
      lines.push(
        `Applied "${r.applied.label}" by ${r.applied.author} as revision ${r.applied.revision}.`,
      );
    if (!r.files.length) lines.push("No files with a moving picture yet.");
    else {
      lines.push(
        "How late each file's picture is against its sound (each clip shows its picture that much later, so lips match the voice):",
      );
      const width = Math.max(...r.files.map((f) => f.id.length));
      for (const f of r.files)
        lines.push(
          `  ${f.id.padEnd(width)}  ${f.path}  ${f.role}  ${f.pictureDelay ? ms(f.pictureDelay) : "as recorded"}${f.pictureDelayCorrected != null ? `, in sync as recorded (Record It took out ${ms(f.pictureDelayCorrected)})` : ""}`,
        );
    }
    lines.push(
      r.defaultDelay === 0
        ? "New camera takes keep their picture as recorded (sidecut sync <seconds> --default sets a delay for them)."
        : `New camera takes get ${ms(r.defaultDelay)} (SideCut's settings).`,
    );
    return lines.join("\n");
  }
  if (operation === "wait") {
    if (!r.finished.length && !r.pending.length)
      return {
        jobs: "No background jobs running.",
        export: "No exports running.",
        transcript: "No transcripts to make.",
        matte: "No cutout mattes to make.",
        proxy: "No proxies to make.",
      }[r.what];
    const failed = r.finished.filter((i) => i.state === "failed").length,
      time = `${Number(r.elapsed).toFixed(1)} s`,
      lines = [
        r.done
          ? `Done after ${time}${failed ? `, ${failed} failed` : ""}:`
          : `Still going after ${time}, when the wait timed out:`,
      ];
    for (const item of [...r.finished, ...r.pending])
      lines.push(
        `  ${r.what === "jobs" ? `${item.kind} ` : ""}${item.path}${item.mode ? ` (${item.mode})` : ""}: ${state(item)}`,
      );
    if (r.timedOut) lines.push("Run the same `sidecut wait` again to keep waiting.");
    return lines.join("\n");
  }
  if (operation === "transcribe") {
    const lines = [];
    if (r.applied)
      lines.push(
        `Applied "${r.applied.label}" by ${r.applied.author} as revision ${r.applied.revision}.`,
      );
    if (r.waited) lines.push(analysisText("wait", r.waited));
    else {
      lines.push("Asked for transcripts of:");
      for (const f of r.files) lines.push(`  ${f.path} (${f.mediaID ?? "?"}): ${state(f)}`);
      const pending = r.files.filter(
        (f) => !["ready", "done", "failed", "cancelled"].includes(f.state),
      );
      if (pending.length)
        lines.push(
          `\`sidecut wait transcript --media ${pending.map((f) => f.mediaID).join(" --media ")}\` waits for them.`,
        );
    }
    const ready = r.files.find((f) => f.state === "ready");
    if (ready?.mediaID) lines.push(`\`sidecut transcript ${ready.mediaID}\` reads it.`);
    return lines.join("\n");
  }
  if (operation === "clips") {
    if (r.idsOnly) return r.clips.map((c) => c.id).join("\n");
    if (!r.clips.length) return "No clips match.";
    const iw = Math.max(...r.clips.map((c) => c.id.length)),
      tw = Math.max(...r.clips.map((c) => c.track.length));
    return [
      `${r.clips.length} clip${r.clips.length === 1 ? "" : "s"} (revision ${r.revision}):`,
      ...r.clips.map(
        (c) =>
          `  ${c.id.padEnd(iw)}  ${c.track.padEnd(tw)}  ${clock(c.start)}-${clock(c.end)}  ${c.content}${c.enabled ? "" : "  off"}`,
      ),
    ].join("\n");
  }
  if (operation === "restore") {
    const changing = r.items.filter((i) => i.action !== "unchanged"),
      lines = [
        changing.length
          ? `Restore ${changing.length} clip${changing.length === 1 ? "" : "s"} as ${changing.length === 1 ? "it was" : "they were"} in ${r.from} (${r.applied ? "applied" : "dry run"}, revision ${r.revision}):`
          : `Nothing to restore: ${r.items.length === 1 ? "the clip is" : "the clips are"} already as ${r.items.length === 1 ? "it was" : "they were"} in ${r.from}.`,
      ];
    for (const i of r.items)
      lines.push(
        `  ${{ putBack: "put back", changeBack: "change back", remove: "take out", unchanged: "already so" }[i.action] ?? i.action}  ${i.id}  ${i.track}  ${clock(i.start)}-${clock(i.end)}  ${i.content}${i.details?.length ? ": " + i.details.join(", ") : ""}`,
      );
    if (r.problem) lines.push(`It wouldn't apply as it stands: ${r.problem}`);
    if (r.applied)
      lines.push(
        `Applied as revision ${r.applied.revision} ("${r.applied.label}"), one undo step. Undo with \`sidecut undo\`.`,
      );
    else if (changing.length)
      lines.push(
        "Nothing changed yet. Run again with --apply (or apply: true) to restore them. Transitions, media and markers aren't restored.",
      );
    return lines.join("\n");
  }
  const counts = (changes) =>
    [
      [changes.filter((c) => c.kind === "added").length, "added"],
      [changes.filter((c) => c.kind === "removed").length, "removed"],
      [changes.filter((c) => c.kind === "changed" && c.shift == null).length, "changed"],
      [changes.filter((c) => c.shift != null).length, "moved"],
    ]
      .filter(([n]) => n > 0)
      .map(([n, w]) => `${n} ${w}`)
      .join(", ");
  const changeLines = (changes, indent) => {
    const shifts = new Map();
    for (const c of changes.filter((change) => change.shift != null)) {
      const group = shifts.get(c.shift) ?? [];
      group.push(c);
      shifts.set(c.shift, group);
    }
    const summed = new Set(
        [...shifts.values()].filter((g) => g.length > 1).flatMap((g) => g.map((c) => c.id)),
      ),
      lines = [];
    for (const c of changes)
      if (!summed.has(c.id))
        lines.push(
          `${indent}${c.kind}  ${c.id}  ${c.track}  ${clock(c.start)}-${clock(c.end)}  ${c.content}${c.details?.length ? ": " + c.details.join(", ") : ""}`,
        );
    for (const [shift, group] of [...shifts].sort((a, b) => a[0] - b[0]))
      if (group.length > 1)
        lines.push(
          `${indent}moved  ${group.length} clips by ${shift < 0 ? "" : "+"}${Number(shift).toFixed(3)}s on ${[...new Set(group.map((c) => c.track))].join(", ")} (from ${clock(Math.min(...group.map((c) => c.wasStart ?? c.start)))})`,
        );
    return lines;
  };
  const lines = [
    `Since ${r.since} (now revision ${r.revision}): ${r.changes.length ? counts(r.changes) + "." : "No clips changed."}`,
  ];
  if (r.edits) {
    let quiet = [];
    const flush = () => {
      if (!quiet.length) return;
      const labels = new Map();
      for (const e of quiet) labels.set(e.label, (labels.get(e.label) ?? 0) + 1);
      lines.push(
        `r${quiet[0].revision}${quiet.length > 1 ? `-r${quiet.at(-1).revision}` : ""}  ${quiet.length} edit${quiet.length === 1 ? "" : "s"} that changed no clips: ${[
          ...labels,
        ]
          .map(([label, n]) => `${label}${n > 1 ? ` x${n}` : ""}`)
          .sort()
          .join(", ")}`,
      );
      quiet = [];
    };
    for (const e of r.edits) {
      if (!e.changes.length) {
        quiet.push(e);
        continue;
      }
      flush();
      lines.push(
        `r${e.revision}  ${e.kind === "undo" ? "Undo " : e.kind === "redo" ? "Redo " : ""}${e.label}  by ${e.author}${e.start != null && e.end != null ? `  ${e.start === e.end ? `at ${clock(e.start)}` : `${clock(e.start)}-${clock(e.end)}`}${e.tracks?.length ? " on " + e.tracks.join(", ") : ""}` : ""}`,
        ...changeLines(e.changes, "    "),
      );
    }
    flush();
  } else lines.push(...changeLines(r.changes, "  "));
  if (r.changes.length)
    lines.push(
      "Full detail (each clip before and after) with --json. Put clips back with sidecut restore --from <revision or file> --clips <ids>.",
    );
  return lines.join("\n");
}
