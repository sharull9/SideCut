// AssetsCommand/SegmentsCommand/AssetText at Tandem 735a9b8. TANDEM-LICENSE applies.
import { clock, parseCommandTime } from "./cli-query-commands.mjs";
import { segmentText } from "./cli-foundation.mjs";
export function prepareLibraryCommand(parsed) {
  const group = parsed.words[0];
  if (!["assets", "segments"].includes(group)) return undefined;
  const command = parsed.words[1] ?? (group === "segments" ? "list" : undefined),
    flags = new Map(parsed.flags),
    positional = parsed.words.slice(2),
    allowed = (
      group === "assets"
        ? {
            providers: [],
            search: [
              "text",
              "kind",
              "kinds",
              "provider",
              "providers",
              "online",
              "limit",
              "max-duration",
            ],
            fetch: ["id", "online"],
            show: ["id"],
            use: ["id", "at", "duration", "anchor", "pop", "label", "mode", "expected-revision"],
            credits: ["optional", "include-optional"],
            generate: [
              "kind",
              "prompt",
              "duration",
              "variations",
              "confirmed-paid",
              "loop",
              "vocals",
            ],
            "install-starter": ["online"],
          }
        : {
            list: [],
            save: ["name", "clips", "clip-ids", "from", "to", "field", "fields", "replace"],
            insert: ["name", "at", "value", "values", "mode", "label", "expected-revision"],
          }
    )[command];
  if (!allowed) throw new Error(`Unknown ${group} command. Use ${group} --help.`);
  for (const key of flags.keys())
    if (
      !["project", "author", "endpoint-file", "input", "request", "json", ...allowed].includes(key)
    )
      throw new Error(`Unknown ${group} ${command} option --${key}.`);
  const set = (field, value) => {
    if (flags.has(field)) throw new Error(`Duplicate ${field}.`);
    flags.set(field, value);
  };
  if (group === "assets" && command === "search" && positional.length)
    set("text", positional.join(" "));
  else if (
    group === "assets" &&
    ["fetch", "show", "use"].includes(command) &&
    positional.length === 1
  )
    set("id", positional[0]);
  else if (group === "assets" && command === "generate" && positional.length === 2) {
    set("kind", positional[0]);
    set("prompt", positional[1]);
  } else if (
    group === "segments" &&
    ["save", "insert"].includes(command) &&
    positional.length === 1
  )
    set("name", positional[0]);
  else if (positional.length) throw new Error(`${group} ${command} got unexpected arguments.`);
  const sourced = flags.has("request") || flags.has("input");
  if (
    group === "assets" &&
    ["fetch", "show", "use"].includes(command) &&
    !flags.has("id") &&
    !sourced
  )
    throw new Error(`${command} needs an asset ID.`);
  if (
    group === "assets" &&
    command === "generate" &&
    (!flags.has("kind") || !flags.has("prompt")) &&
    !sourced
  )
    throw new Error("generate needs sfx or music and a quoted prompt.");
  if (
    group === "segments" &&
    ["save", "insert"].includes(command) &&
    !flags.has("name") &&
    !sourced
  )
    throw new Error(`${command} needs a segment name.`);
  if (group === "segments" && command === "insert" && !flags.has("at") && !sourced)
    throw new Error("segments insert needs --at.");
  if (group === "segments" && command === "save") {
    if ((flags.has("clips") || flags.has("clip-ids")) && (flags.has("from") || flags.has("to")))
      throw new Error("Give --clips or --from and --to, not both.");
    if (!["clips", "clip-ids", "from", "to"].some((key) => flags.has(key)) && !sourced)
      throw new Error("segments save needs clips or a time range.");
  }
  if (group === "assets" && command === "credits" && flags.has("optional")) {
    if (flags.has("include-optional")) throw new Error("Choose --optional or --include-optional.");
    flags.set("include-optional", true);
    flags.delete("optional");
  }
  const mutation =
    (group === "assets" && command === "use") || (group === "segments" && command === "insert");
  if (!mutation) flags.delete("author");
  for (const key of ["at", "from", "to", "duration"])
    if (flags.has(key)) parseCommandTime(flags.get(key));
  const operation =
    group === "assets"
      ? `assets-${command}`
      : { list: "segments", save: "save-segment", insert: "insert-segment" }[command];
  return {
    flags,
    words: [group, command],
    prepare(input) {
      input = { ...input };
      if (mutation && input.author == null)
        input.author = process.env.SIDECUT_AUTHOR ?? process.env.TANDEM_AUTHOR ?? "cli";
      for (const key of ["at", "from", "to", "duration"])
        if (input[key] != null) input[key] = parseCommandTime(input[key]);
      if (operation === "assets-search") {
        if (input.text == null) input.text = "";
        if (input.online == null) input.online = false;
      }
      if (operation === "assets-generate") {
        if (input.confirmedPaid == null) input.confirmedPaid = false;
        const kind = String(input.kind ?? "").toLowerCase();
        input.kind = { sound: "sfx", sounds: "sfx", effects: "sfx", songs: "music" }[kind] ?? kind;
        if (
          !["sfx", "music"].includes(input.kind) ||
          typeof input.prompt !== "string" ||
          !input.prompt.trim()
        )
          throw new Error("generate needs sfx or music and a prompt.");
      }
      if (operation === "insert-segment" && input.at == null)
        throw new Error("segments insert needs --at.");
      return input;
    },
    text: flags.has("json")
      ? undefined
      : (r) => (group === "segments" ? segmentText(operation, r) : libraryText(operation, r)),
  };
}
const licence = (kind) =>
  ({
    noCredit: "no credit",
    creditNeeded: "credit needed",
    subscription: "subscription",
    aiGenerated: "ai generated",
    unknown: "unknown licence",
  })[kind] ?? kind;
const state = (kind) =>
  ({
    remote: "not downloaded",
    preview: "preview only",
    original: "downloaded",
    normalised: "ready",
  })[kind] ?? kind;
const providerState = (kind) =>
  ({
    ready: "ready",
    needsKey: "needs a key",
    disabled: "off",
    stub: "not set up",
    limited: "partly working",
  })[kind] ?? kind;
const number = (v) => Number(Number(v).toPrecision(6)).toString();
function table(assets, indent = "  ") {
  const rows = assets.map((a) => [
      a.id,
      a.kind,
      a.name,
      a.duration == null ? "" : `${Number(a.duration).toFixed(2)}s`,
      licence(a.licenceClass),
      state(a.state),
    ]),
    widths = Array.from({ length: 5 }, (_, i) => Math.max(0, ...rows.map((r) => r[i].length)));
  return rows.map(
    (row) =>
      indent +
      row
        .map((value, i) => (i < 5 ? value.padEnd(Math.min(widths[i], i === 2 ? 44 : 60)) : value))
        .join("  ")
        .trimEnd(),
  );
}
export function libraryText(operation, r) {
  if (operation === "assets-providers") {
    const widths = [
        Math.max(0, ...r.providers.map((p) => p.id.length)),
        Math.max(0, ...r.providers.map((p) => p.displayName.length)),
        Math.max(0, ...r.providers.map((p) => providerState(p.status.state).length)),
      ],
      lines = ["Asset sources:"];
    for (const p of r.providers) {
      const what = [p.kinds.join(", ")];
      if (p.capabilities.generate) what.push("generates");
      if (p.capabilities.search) what.push("searches");
      lines.push(
        `  ${p.id.padEnd(widths[0])}  ${p.displayName.padEnd(widths[1])}  ${providerState(p.status.state).padEnd(widths[2])}  ${what.join("; ")}`,
      );
      if (p.status.message) lines.push(`      ${p.status.message}`);
    }
    return lines.join("\n");
  }
  if (operation === "assets-search") {
    const about = r.text ? ` for "${r.text}"` : "",
      lines = r.local.length
        ? [
            `${r.local.length < r.total ? `${r.local.length} of ${r.total}` : r.total} in the library${about}:`,
            ...table(r.local),
          ]
        : [`Nothing in the library${about}.`];
    if (r.online) {
      lines.push("Online:");
      for (const a of r.online) {
        if (a.error) lines.push(`  ${a.provider}: couldn't search. ${a.error}`);
        else if (!a.assets.length) lines.push(`  ${a.provider}: nothing found`);
        else lines.push(`  ${a.provider}: ${a.assets.length} found`, ...table(a.assets, "    "));
      }
    } else if (!r.local.length)
      lines.push(
        "Search the providers too with --online (MCP: online: true), or add the starter set with install-starter.",
      );
    if (r.local.length || r.online?.some((a) => a.assets?.length))
      lines.push("Add one to the project with assets use <id> (and at <time> to place it).");
    return lines.join("\n");
  }
  if (operation === "assets-fetch") {
    const parts = [r.asset.kind];
    if (r.asset.duration != null) parts.push(`${Number(r.asset.duration).toFixed(2)}s`);
    const lines = [
      `${r.asset.name} (${parts.join(", ")}) is ${state(r.asset.state)}: ${r.file ?? "no file"}`,
    ];
    if (r.licence)
      lines.push(
        `Licence: ${r.licence.name} (${licence(r.licence.licenceClass)})${r.licence.creditLine ? `. Credit: ${r.licence.creditLine}` : ""}`,
      );
    return lines.join("\n");
  }
  if (operation === "assets-show") {
    const a = r.asset,
      parts = [a.kind];
    if (a.duration != null) parts.push(`${Number(a.duration).toFixed(2)} s`);
    parts.push(state(a.state));
    const lines = [
      `${a.id}  ${parts.join(", ")}`,
      `Name: ${a.name}`,
      `Provider: ${a.provider}${r.model ? ` (model ${r.model})` : ""}`,
    ];
    if (r.prompt) lines.push(`Prompt: ${r.prompt}`);
    else if (a.summary) lines.push(`About: ${a.summary}`);
    const details = [];
    if (a.bpm != null) details.push(`${number(a.bpm)} BPM`);
    if (a.musicalKey) details.push(a.musicalKey);
    if (a.width != null && a.height != null)
      details.push(`${a.width}x${a.height}${a.hasAlpha ? " with alpha" : ""}`);
    if (details.length) lines.push("Details: " + details.join(", "));
    if (a.loudness && Number.isFinite(a.loudness.integratedLUFS))
      lines.push(
        `Loudness: ${Number(a.loudness.integratedLUFS).toFixed(1)} LUFS, true peak ${Number(a.loudness.truePeakDBTP).toFixed(1)} dBTP, range ${Number(a.loudness.loudnessRange).toFixed(1)} LU`,
      );
    else if (["music", "sfx"].includes(a.kind))
      lines.push("Loudness: not measured yet (it is once the asset is fetched)");
    let text = `Licence: ${licence(r.licence?.licenceClass ?? a.licenceClass)}`;
    if (r.licence) {
      text = `Licence: ${r.licence.name} (${licence(r.licence.licenceClass)})`;
      if (r.licence.holder) text += `. Holder: ${r.licence.holder}`;
    }
    const credit = r.licence?.creditLine ?? a.creditLine;
    if (credit) text += `. Credit: ${credit}`;
    if (r.licence?.url) text += `. Terms: ${r.licence.url}`;
    lines.push(text);
    lines.push("File: " + (r.file ?? `not downloaded yet (assets fetch ${a.id})`));
    if (r.original && r.original !== r.file) lines.push(`Original: ${r.original}`);
    if (a.pageURL) lines.push(`Page: ${a.pageURL}`);
    if (a.tags?.length) lines.push("Tags: " + a.tags.join(", "));
    return lines.join("\n");
  }
  if (operation === "assets-use") {
    const a = r.asset,
      lines = [];
    if (r.mediaID == null) {
      if (r.fonts?.length) {
        lines.push(
          `Installed the font ${a.name} (${r.fonts.join(", ")}). Use it in a title's style: {"font": "${r.fonts[0]}"}.`,
        );
        if (r.referencedInPlace)
          lines.push(
            `It stays in the shared library (${r.files.join(", ")}), where every SideCut render finds it; archiving copies it into the project's assets/font/.`,
          );
        if (r.fontsReached)
          lines.push(
            r.fontsReached === "app"
              ? "The SideCut app has it now too."
              : "sidecut serve has it now too.",
          );
        lines.push(...(r.fontWarnings ?? []).map((w) => `Warning: ${w}`));
      } else
        lines.push(
          r.referencedInPlace
            ? `${a.name} is used where it is in the shared library: ${r.files.join(", ")}.`
            : `Copied ${a.name} into the project: ${r.files.join(", ")}.`,
        );
    } else if (r.at != null && r.applied) {
      lines.push(
        `Placed ${a.name} (${a.kind}) at ${clock(r.at)} on ${r.trackName ?? "its track"}${r.gainDB != null ? ` at ${number(r.gainDB)} dB` : ""} as revision ${r.applied.revision}.`,
        `Media ${r.mediaID}: ${r.files.join(", ")}. Clips: ${r.applied.createdIDs.filter((id) => id.startsWith("clip_")).join(", ")}.`,
        ...r.applied.warnings.map((w) => `Warning: ${w}`),
      );
    } else if (r.applied)
      lines.push(
        `Added ${a.name} to the project's media as ${r.mediaID} (revision ${r.applied.revision}): ${r.files.join(", ")}.`,
        `Place it with placeMedia {"mediaIDs": ["${r.mediaID}"], "at": <seconds>}, or use the asset again with at.`,
      );
    else lines.push(`${a.name} is already in the project as ${r.mediaID}: ${r.files.join(", ")}.`);
    if (r.referencedInPlace && r.mediaID != null)
      lines.push(
        "It's the shared library's file, not a copy: changing it there changes it here, and archiving the project copies it in.",
      );
    if (
      ["creditNeeded", "unknown"].includes(r.licence?.licenceClass) ||
      a.licenceClass === "creditNeeded"
    )
      lines.push("It needs a credit in the description; assets credits has the line.");
    return lines.join("\n");
  }
  if (operation === "assets-credits") {
    const lines = r.text
        ? ["Paste into the description:", "", r.text]
        : ["Nothing in this project needs a credit."],
      optional = r.credits.entries.filter((e) => !e.required);
    if (!r.includeOptional && optional.length)
      lines.push(
        "",
        "Courtesy credits nobody requires (include them with optional credits):",
        ...optional.map((e) => `  ${e.line}`),
      );
    if (r.credits.warnings.length)
      lines.push("", "Before publishing:", ...r.credits.warnings.map((w) => `  - ${w}`));
    if (r.credits.assets.length)
      lines.push(
        "",
        `Assets used (${r.credits.assets.length}):`,
        ...r.credits.assets.map(
          (a) =>
            `  ${a.id}  ${a.name}  ${licence(a.licenceClass)}${a.licence ? `, ${a.licence}` : ""}`,
        ),
      );
    return lines.join("\n");
  }
  if (operation === "assets-generate") {
    const noun = r.assets[0]?.kind === "music" ? "music cue" : "sound effect",
      lines = r.assets.length
        ? [
            `Made ${r.assets.length} ${noun}${r.assets.length === 1 ? "" : "s"}:`,
            ...table(r.assets),
            "Add one to the project with assets use <id> (and at <time> to place it).",
          ]
        : ["Nothing was made."];
    lines.push(...r.failures.map((f) => `Failed: ${f}`));
    return lines.join("\n");
  }
  const order = ["sticker", "icon", "logo"],
    parts = Object.keys(r.counts)
      .sort(
        (a, b) =>
          (order.includes(a) ? order.indexOf(a) : 9) - (order.includes(b) ? order.indexOf(b) : 9) ||
          a.localeCompare(b),
      )
      .map((k) => `${r.counts[k]} ${k}${r.counts[k] === 1 ? "" : "s"}`);
  return `The starter set is in the library: ${parts.join(", ")} (${r.total} assets). Each downloads the first time it's used.`;
}
