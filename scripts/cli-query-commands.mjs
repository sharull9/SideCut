// TandemCLI/CLI.swift and TandemAPI/ReadableText.swift at 735a9b8.
// Notice: tests/fixtures/tandem/TANDEM-LICENSE.
const helpers = new Set(["pauses", "tighten", "join", "captions", "short"]);
const commands = new Set(["status", "media", "timeline", "transcript", "search", ...helpers]);
export function queryHelp(topic) {
  const usage = {
    status: "status [--revision] [--json]",
    media: "media [--refresh] [--json]",
    timeline: "timeline [--from TIME --to TIME] [--words] [--summary] [--json]",
    transcript:
      "transcript [MEDIA_OR_CLIP_ID] [--from TIME --to TIME] [--make --timeout SECONDS] [--json]",
    search: 'search "PHRASE" [--limit COUNT] [--json]',
    pauses: "pauses [--min SECONDS] [--from TIME --to TIME] [--json]",
    tighten:
      "tighten [--min SECONDS --keep SECONDS] [--sentence SECONDS --comma SECONDS --mid SECONDS --mid-min SECONDS] [--mike] [--protect TIME ...] [--widen] [--from TIME --to TIME] [--apply] [--expect REVISION] [--json]",
    join: "join [--from TIME --to TIME] [--apply] [--expect REVISION] [--json]",
    captions:
      "captions [--max-words COUNT] [--y NUMBER] [--track NAME] [--from TIME --to TIME] [--apply] [--expect REVISION] [--json]",
    short: "short [--copy [-o FILE]] [--apply] [--expect REVISION] [--json]",
  }[topic];
  return usage
    ? `Usage: sidecut ${usage}\nReadable output is the default; --json preserves the service result.${helpers.has(topic) && topic !== "pauses" ? "\nPreview by default. --apply commits; --label and --author annotate the edit." : ""}\n--project PATH selects a project; --endpoint-file PATH selects its authenticated running host.`
    : undefined;
}
export function prepareQueryCommand(parsed) {
  const offset = parsed.words[0] === "project" ? 1 : 0,
    operation = parsed.words[offset];
  if (!commands.has(operation)) return undefined;
  const flags = new Map(parsed.flags),
    words = parsed.words.slice(0, offset + 1),
    positional = parsed.words.slice(offset + 1),
    allowed = {
      status: ["revision"],
      media: ["refresh"],
      timeline: ["from", "to", "words", "summary", "format"],
      transcript: ["id", "from", "to", "make", "timeout"],
      search: ["phrase", "limit"],
      pauses: ["min", "from", "to"],
      tighten: [
        "min",
        "keep",
        "sentence",
        "comma",
        "mid",
        "mid-min",
        "mid-minimum",
        "mike",
        "protect",
        "widen",
        "from",
        "to",
        "apply",
        "label",
        "expected-revision",
      ],
      join: ["from", "to", "apply", "label", "expected-revision"],
      captions: [
        "max-words",
        "words",
        "y",
        "track",
        "from",
        "to",
        "apply",
        "label",
        "expected-revision",
      ],
      short: ["copy", "output", "copy-path", "apply", "label", "expected-revision"],
    }[operation];
  for (const key of flags.keys())
    if (
      !["json", "project", "author", "endpoint-file", "input", "request", ...allowed].includes(key)
    )
      throw new Error(`Unknown ${operation} option --${key}.`);
  if (operation === "search" && positional.length) {
    if (flags.has("phrase")) throw new Error("Duplicate search phrase.");
    flags.set("phrase", positional.join(" "));
  } else if (operation === "transcript" && positional.length === 1) {
    if (flags.has("id")) throw new Error("Duplicate transcript ID.");
    flags.set("id", positional[0]);
  } else if (positional.length) throw new Error(`${operation} got unexpected arguments.`);
  if (
    operation === "search" &&
    !flags.has("phrase") &&
    !flags.has("input") &&
    !flags.has("request")
  )
    throw new Error("search needs a phrase.");
  if (flags.has("make") && !flags.has("id") && !flags.has("input") && !flags.has("request"))
    throw new Error("--make needs a media or clip ID.");
  if (!helpers.has(operation) || operation === "pauses") flags.delete("author");
  if (operation === "short" && flags.has("copy-path")) flags.set("copy", true);
  for (const [source, target] of [
    ["max-words", "words"],
    ["mid-minimum", "mid-min"],
    ["copy-path", "output"],
  ]) {
    if (!flags.has(source)) continue;
    if (flags.has(target)) throw new Error(`Choose --${source} or --${target}.`);
    flags.set(target, flags.get(source));
    flags.delete(source);
  }
  if (operation === "short" && flags.has("output") && !flags.has("copy"))
    throw new Error("--output needs --copy.");
  if (operation === "short" && flags.has("output")) {
    flags.set(
      "copy-path",
      String(flags.get("output")).endsWith(".tandem")
        ? flags.get("output")
        : `${flags.get("output")}.tandem`,
    );
    flags.delete("output");
  }
  const revisionOnly = flags.has("revision"),
    make = flags.has("make"),
    rawTimeout = flags.get("timeout"),
    timeout = rawTimeout == null ? undefined : Number(rawTimeout);
  if (rawTimeout != null && (rawTimeout === true || !Number.isFinite(timeout) || timeout < 0))
    throw new Error("--timeout needs nonnegative seconds.");
  flags.delete("revision");
  flags.delete("make");
  flags.delete("timeout");
  return {
    flags,
    words,
    operation,
    revisionOnly,
    make,
    timeout,
    prepare(input) {
      if (helpers.has(operation) && operation !== "pauses") {
        if (input.apply == null) input.apply = false;
        if (input.author == null)
          input.author = process.env.SIDECUT_AUTHOR ?? process.env.TANDEM_AUTHOR ?? "cli";
      }
      if (operation === "timeline" && input.format == null)
        input.format = flags.has("json") ? "json" : "text";
      if (operation === "search" && (typeof input.phrase !== "string" || !input.phrase.trim()))
        throw new Error("search needs a phrase.");
      if (make && (typeof input.id !== "string" || !input.id))
        throw new Error("--make needs a media or clip ID.");
      return input;
    },
    text: flags.has("json")
      ? undefined
      : (result) => (revisionOnly ? String(result.revision) : queryText(operation, result)),
  };
}
export function clock(seconds) {
  const millis = Math.round(Math.abs(Number(seconds)) * 1000),
    hours = Math.floor(millis / 3600000),
    minutes = Math.floor(millis / 60000) % 60,
    rest = `${String(Math.floor(millis / 1000) % 60).padStart(2, "0")}.${String(millis % 1000).padStart(3, "0")}`;
  return `${seconds < 0 ? "-" : ""}${hours ? `${hours}:${String(minutes).padStart(2, "0")}` : String(minutes).padStart(2, "0")}:${rest}`;
}
const leaf = (path) =>
  String(path ?? "")
    .split(/[\\/]/)
    .at(-1);
const number = (value) => Number(Number(value).toPrecision(6)).toString();
const duration = (value) => (Math.abs(value) < 60 ? `${Number(value).toFixed(3)}s` : clock(value));
const milliseconds = (value) => `${Math.sign(value) * Math.round(Math.abs(value) * 1000)} ms`;
const codecName = (code) =>
  ({
    "rle ": "QuickTime Animation",
    "png ": "PNG video",
    "smc ": "QuickTime Graphics",
    rpza: "Apple Video",
    cvid: "Cinepak",
    SVQ1: "Sorenson Video",
    SVQ3: "Sorenson Video",
    AVdn: "DNxHD",
    AVdh: "DNxHR",
    CFHD: "CineForm",
  })[code] ??
  (["Hap1", "Hap5", "HapY", "HapM", "HapA", "Hap7"].includes(code)
    ? "HAP"
    : `${code.trim()} video`);
function analysisSummary(analysis = {}) {
  const order = [
      "converted",
      "transcript",
      "loudness",
      "waveform",
      "thumbnails",
      "proxy",
      "matte",
      "isolatedVoice",
    ],
    keys = Object.keys(analysis).sort(
      (a, b) =>
        (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) -
          (order.indexOf(b) < 0 ? 99 : order.indexOf(b)) || a.localeCompare(b),
    );
  const values = keys
    .filter((k) => analysis[k].state !== "none")
    .map((k) => {
      const value = analysis[k];
      return value.progress != null
        ? `${k} ${Math.trunc(value.progress * 100)}%`
        : value.message
          ? `${k} ${value.state}: ${value.message}`
          : `${k} ${value.state}`;
    });
  return !keys.length
    ? "(no analysis applies)"
    : values.length
      ? `(${values.join(", ")})`
      : "(not analysed yet)";
}
export function queryText(operation, result) {
  if (helpers.has(operation)) return helperText(operation, result);
  if (operation === "timeline")
    return (
      result.text?.replace(/\n$/, "") ??
      (result.project ? JSON.stringify(result.project) : `Revision ${result.revision}`)
    );
  if (operation === "status") {
    const lines = [
      `${result.name} (${leaf(result.path)})`,
      `  revision ${result.revision}, ${result.dirty ? "unsaved changes" : "saved"}, ${clock(result.duration)} long, ${result.width}x${result.height} at ${number(result.frameRate)} fps`,
      `  ${result.tracks} tracks, ${result.clips} clips, ${result.media} media files, ${result.markers} markers`,
    ];
    if (result.headless) lines.push("  open in: nothing else, read from the file for this command");
    else if (result.openIn)
      lines.push(
        `  open in: ${result.openIn.owner === "app" ? "the SideCut app" : `sidecut ${result.openIn.owner}`} (pid ${result.openIn.pid})${result.openIn.port ? `, serving the API on port ${result.openIn.port}` : ""}`,
      );
    for (const key of ["undo", "redo"]) if (result[key]) lines.push(`  ${key}: ${result[key]}`);
    if (result.recoveredEdits)
      lines.push("  recovered unsaved edits from the journal after a crash");
    const pending = result.reviewPending ?? [];
    if (pending.length) {
      const names = pending.slice(-3).map((p) => `${p.label} by ${p.author}`);
      if (pending.length > names.length) names.push(`${pending.length - names.length} more`);
      lines.push(
        `  waiting for review: ${pending.length} agent edit${pending.length === 1 ? "" : "s"} (${names.join("; ")})`,
      );
    }
    const active = (result.jobs ?? []).filter((j) => ["queued", "running"].includes(j.state));
    lines.push(active.length ? "  background jobs:" : "  background jobs: none");
    for (const job of active)
      lines.push(
        `    ${job.kind} ${job.mediaID} ${job.state}${job.state === "running" ? ` ${Math.trunc(job.progress * 100)}%` : ""}`,
      );
    for (const job of result.exports ?? [])
      lines.push(`  exporting ${leaf(job.output)} ${Math.trunc(job.progress * 100)}%`);
    for (const warning of result.warnings ?? []) lines.push(`Warning: ${warning}`);
    return lines.join("\n");
  }
  if (operation === "media") {
    if (!result.items.length)
      return "No media in the project yet. Put files in the project folder and run `sidecut media --refresh`.";
    const lines = [],
      width = Math.max(...result.items.map((i) => i.id.length));
    if (result.added?.length)
      lines.push(`Added ${result.added.length} new file${result.added.length === 1 ? "" : "s"}.`);
    for (const item of result.items) {
      const parts = [item.id.padEnd(width), item.path, item.role];
      if (item.duration != null) parts.push(clock(item.duration));
      if (item.width && item.height) parts.push(`${item.width}x${item.height}`);
      if (item.undecodableCodec) parts.push(codecName(item.undecodableCodec));
      if (item.livePhotoVideo) parts.push(`Live Photo, motion clip ${leaf(item.livePhotoVideo)}`);
      if (item.takeID) parts.push(`take ${item.takeID} +${duration(item.takeOffset ?? 0)}`);
      if (item.pictureDelay)
        parts.push(`picture ${milliseconds(item.pictureDelay)} late, shown in sync`);
      if (item.pictureDelayCorrected != null)
        parts.push(
          `in sync as recorded (Record It took out ${milliseconds(item.pictureDelayCorrected)})`,
        );
      parts.push(`${item.clips} clip${item.clips === 1 ? "" : "s"}`);
      if (!item.exists) parts.push("MISSING FILE");
      parts.push(analysisSummary(item.analysis));
      lines.push(parts.join("  "));
    }
    return lines.join("\n");
  }
  if (operation === "transcript") {
    const lines = [
      result.scope === "media"
        ? `Transcript of ${result.id ?? ""} (times are in the file)`
        : result.scope === "clip"
          ? `Transcript of clip ${result.id ?? ""} (timeline times)`
          : "What's said on the timeline",
    ];
    let current = [],
      start,
      previousEnd;
    for (const word of result.words) {
      const gap = previousEnd == null ? 0 : word.start - previousEnd;
      if (current.length && (current.length >= 12 || gap >= 0.5)) {
        lines.push(`${clock(start)}  ${current.join(" ")}`);
        current = [];
      }
      if (!current.length) {
        start = word.start;
        if (previousEnd != null && gap >= 0.5) lines.push(`           [pause ${duration(gap)}]`);
      }
      current.push(word.text);
      previousEnd = word.end;
    }
    if (current.length) lines.push(`${clock(start)}  ${current.join(" ")}`);
    if (!result.words.length) lines.push(result.missing.length ? "(no words yet)" : "(no words)");
    if (result.missing.length)
      lines.push(
        `No transcript yet for: ${result.missing.join(", ")}. \`sidecut media\` shows progress.`,
      );
    return lines.join("\n");
  }
  const lines = result.hits.length
    ? [
        `"${result.phrase}" on the timeline, ${result.hits.length} time${result.hits.length === 1 ? "" : "s"}:`,
        ...result.hits.map(
          (h) =>
            `  ${clock(h.start)}-${clock(h.end)}  ...${h.before} [${h.text}] ${h.after}...  clips ${h.clipIDs.join(",")}${h.partial ? "  (cut runs through it)" : ""}`,
        ),
      ]
    : [`"${result.phrase}" isn't said on the timeline.`];
  if (result.unused.length)
    lines.push(
      "In the source but not on the timeline:",
      ...result.unused.map(
        (h) =>
          `  ${h.mediaID} at ${clock(h.mediaStart)}-${clock(h.mediaEnd)} (file time)  ...${h.before} [${h.text}] ${h.after}...`,
      ),
    );
  if (result.missing.length)
    lines.push(`Not searched, no transcript yet: ${result.missing.join(", ")}.`);
  return lines.join("\n");
}

function helperText(operation, r) {
  const lines = [],
    applied = r.applied,
    mode = applied ? "applied" : "dry run",
    plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`,
    range = (a, b) => `${clock(a)}-${clock(b)}`;
  let action = "";
  if (operation === "pauses") {
    lines.push(
      r.pauses.length
        ? `${plural(r.pauses.length, "pause")} of ${duration(r.minimum)} or more, ${duration(r.total)} in all:`
        : `No pauses of ${duration(r.minimum)} or more.`,
    );
    for (const p of r.pauses)
      lines.push(
        `  ${range(p.start, p.end)}  ${duration(p.duration)}  ...${p.before} | ${p.after}...`,
      );
    if (r.missing.length)
      lines.push(`No transcript yet for ${r.missing.join(", ")}, so pauses there aren't listed.`);
    return lines.join("\n");
  }
  if (operation === "join") {
    action = "join them";
    lines.push(
      r.joins.length
        ? `Join ${plural(r.joins.length, "through-edit")} (${mode}, revision ${r.revision}), each into one clip that plays what the two did:`
        : r.skipped.length
          ? "No through-edits that can be joined."
          : "No through-edits to join.",
    );
    for (const join of r.joins)
      lines.push(
        `  ${clock(join.time)}  ${join.clips.map((p) => `${p.track} ${p.clipID} + ${p.nextClipID}`).join(", ")}`,
      );
    if (r.skipped.length)
      lines.push(
        `Leaves ${r.skipped.length === 1 ? "1 cut that looks like a through-edit" : `${r.skipped.length} cuts that look like through-edits`}, as joining would change what plays:`,
      );
    for (const skip of r.skipped)
      lines.push(
        `  ${clock(skip.time)}  ${skip.track} ${skip.clipID} + ${skip.nextClipID}: ${skip.reason}`,
      );
    if (!r.joins.length) action = "";
  } else if (operation === "captions") {
    action = r.captions.length ? "add them" : "";
    lines.push(
      r.captions.length
        ? `${plural(r.captions.length, "caption")} on "${r.track}" (${mode}, revision ${r.revision}):`
        : "Nothing to caption: no transcribed speech in that range.",
    );
    for (const caption of r.captions.slice(0, 40))
      lines.push(`  ${range(caption.start, caption.end)}  ${caption.text}`);
    if (r.captions.length > 40) lines.push(`  ...and ${r.captions.length - 40} more.`);
    for (const font of r.installedFonts ?? [])
      lines.push(
        `Installed ${font.name}, the ${font.presetID} preset's font, into the project: ${font.files.join(", ")}.`,
      );
  } else if (operation === "short") {
    const counts = ["top", "bottom", "full"]
      .filter((slot) => r.placed[slot] != null)
      .map((slot) => `${r.placed[slot]} in the ${slot === "full" ? "full frame" : `${slot} half`}`);
    lines.push(
      counts.length
        ? `9:16 short "${r.format.name}" (${r.format.width}x${r.format.height}, ${r.copy ? "its own project" : mode}, revision ${r.revision}): ${counts.join(", ")}.`
        : "Nothing to place: no video clips from media.",
    );
    for (const warning of r.warnings ?? []) lines.push(`Warning: ${warning}`);
    if (r.copy)
      lines.push(
        `Made the short its own 1080x1920 project: ${r.copy}. This project is unchanged. Open the short with \`sidecut app "${r.copy}"\` and cut it down there; \`sidecut export --preset short\` renders it.`,
      );
    else if (!applied && counts.length && r.commands.some((c) => c.adoptFormat))
      lines.push("Nothing written yet. Run again with --apply to make the copy.");
    else if (applied)
      lines.push(
        `Applied as revision ${applied.revision}. Render it with \`sidecut export --preset short\` or look with \`sidecut frame <time> --format portrait\`.`,
      );
    else if (counts.length)
      lines.push("Nothing changed yet. Run again with --apply (or apply: true) to lay it out.");
    return lines.join("\n");
  } else if (operation === "tighten") {
    const bySentence = r.sentence != null || r.comma != null || r.mid != null,
      keeps = [
        ["sentence", "after a sentence"],
        ["comma", "after a comma"],
        ["mid", "mid-sentence"],
      ]
        .filter(([key]) => r[key] != null)
        .map(([key, label]) => `${duration(r[key])} ${label}`)
        .join(", ");
    action = r.cuts.length || r.widened.length ? "make the cut" : "";
    if (!action)
      lines.push(
        bySentence
          ? `Nothing to tighten: keeping ${keeps}, no pause would lose a frame.`
          : `Nothing to tighten: no pauses of ${duration(r.minimum)} or more that would lose a frame.`,
      );
    else {
      lines.push(
        bySentence
          ? `Keep ${keeps} (sentence pauses of ${duration(r.minimum)} or more${r.midMinimum != null ? `, comma and mid-sentence ones of ${duration(r.midMinimum)} or more` : ""}; ${mode}, revision ${r.revision}):`
          : `Shorten ${plural(r.cuts.length, "pause")} of ${duration(r.minimum)} or more to ${duration(r.keep)} (${mode}, revision ${r.revision}):`,
      );
      for (const cut of r.cuts)
        lines.push(
          `  ${range(cut.pause.start, cut.pause.end)}  ${duration(cut.pause.duration)}${bySentence && cut.kind ? ` ${cut.kind}` : ""} -> cut ${range(cut.cut.start, cut.cut.end)}  ...${cut.pause.before} | ${cut.pause.after}...`,
        );
      if (r.widened.length)
        lines.push(
          `Widen ${plural(r.widened.length, "join")} to their keep, from silence in the take:`,
        );
      for (const widen of r.widened)
        lines.push(
          `  ${range(widen.pause.start, widen.pause.end)}  ${duration(widen.pause.duration)} ${widen.kind} -> +${duration(widen.added)} at the join at ${clock(widen.at)} (${duration(widen.tail)} after, ${duration(widen.head)} before)  ...${widen.pause.before} | ${widen.pause.after}...`,
        );
      lines.push(
        `Removes ${duration(r.removed)}${r.added > 0 ? `, adds ${duration(r.added)}` : ""}: ${clock(r.durationBefore)} -> ${clock(r.durationAfter)}.`,
      );
    }
    if (r.protected.length)
      lines.push(
        `Left ${plural(r.protected.length, "protected pause")} alone: ${r.protected.map((p) => range(p.start, p.end)).join(", ")}.`,
      );
  }
  for (const warning of r.warnings ?? []) lines.push(`Warning: ${warning}`);
  if (applied)
    lines.push(
      `Applied as revision ${applied.revision} ("${applied.label}"). Undo with \`sidecut undo\`.`,
    );
  else if (action)
    lines.push(`Nothing changed yet. Run again with --apply (or apply: true) to ${action}.`);
  return lines.join("\n");
}
