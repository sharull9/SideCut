// TandemCLI/CLI.swift, ReadableText.swift and SoundCheck.swift at 735a9b8.
// Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { clock, parseCommandTime } from "./cli-query-commands.mjs";
const commands = new Set(["frames", "screenshot", "clip", "export", "loudness"]);
export function prepareRenderCommand(parsed) {
  const offset = parsed.words[0] === "project" ? 1 : 0,
    operation = parsed.words[offset];
  if (!commands.has(operation)) return undefined;
  const flags = new Map(parsed.flags),
    positional = parsed.words.slice(offset + 1),
    allowed = {
      frames: ["times", "every", "from", "to", "width", "output", "format"],
      screenshot: ["output"],
      clip: ["start", "end", "output", "preset", "tracks", "audio-only"],
      export: ["preset", "output", "from", "to", "format"],
      loudness: ["media-id", "from", "to", "step", "tracks", "gains", "over"],
    }[operation];
  for (const flag of flags.keys())
    if (
      !["project", "author", "endpoint-file", "input", "request", "json", ...allowed].includes(flag)
    )
      throw new Error(`Unknown ${operation} option --${flag}.`);
  flags.delete("author");
  if (operation === "frames" && positional.length) {
    if (flags.has("times")) throw new Error("Duplicate frame times.");
    flags.set("times", JSON.stringify(positional.map(parseCommandTime)));
  } else if (operation === "clip" && positional.length === 2) {
    if (flags.has("start") || flags.has("end")) throw new Error("Duplicate clip range.");
    flags.set("start", positional[0]);
    flags.set("end", positional[1]);
  } else if (operation === "loudness" && positional.length === 1) {
    if (flags.has("media-id")) throw new Error("Duplicate loudness media ID.");
    flags.set("media-id", positional[0]);
  } else if (positional.length) throw new Error(`${operation} got unexpected arguments.`);
  const sourced = flags.has("input") || flags.has("request");
  if (operation === "frames" && !flags.has("times") && !flags.has("every") && !sourced)
    throw new Error("frames needs times or --every.");
  if (operation === "clip" && (!flags.has("start") || !flags.has("end")) && !sourced)
    throw new Error("clip needs a start and an end.");
  for (const key of ["start", "end", "from", "to", "every", "step"])
    if (flags.has(key)) parseCommandTime(flags.get(key));
  return {
    flags,
    words: parsed.words.slice(0, offset + 1),
    prepare(input) {
      input = { ...input };
      for (const key of ["start", "end", "from", "to", "every", "step"])
        if (input[key] != null) input[key] = parseCommandTime(input[key]);
      if (input.tracks != null) {
        if (!Array.isArray(input.tracks) || input.tracks.some((t) => typeof t !== "string"))
          throw new Error("tracks must be a list of track names.");
        const tracks = input.tracks
          .flatMap((t) => t.split(","))
          .map((t) => t.trim())
          .filter(Boolean);
        if (tracks.length) input.tracks = tracks;
        else delete input.tracks;
      }
      if (operation === "clip" && (input.start == null || input.end == null))
        throw new Error("clip needs a start and an end.");
      if (operation === "frames") {
        const times = input.times ?? [];
        if (!Array.isArray(times) || times.length > 1000)
          throw new Error("times must be a list of at most 1000 times.");
        input.times = times.map(parseCommandTime);
        if (!times.length && input.every == null) throw new Error("frames needs times or --every.");
        if (input.output == null) {
          const safe = (t) => clock(t).replaceAll(":", ".");
          let name = "frames";
          if (input.every != null) {
            name += `-every-${number(input.every)}s`;
            if (input.from != null || input.to != null)
              name += `-${safe(input.from ?? 0)}-${input.to == null ? "end" : safe(input.to)}`;
          } else {
            const first = Math.min(...input.times),
              last = Math.max(...input.times);
            name += `-${safe(first)}${last === first ? "" : `-${safe(last)}`}`;
          }
          input.output = name + ".png";
        }
      }
      if (operation === "screenshot" && input.output == null) input.output = "sidecut-window.png";
      return input;
    },
    text: flags.has("json") ? undefined : (r) => renderText(operation, r),
  };
}
const number = (v) => Number(Number(v).toPrecision(6)).toString();
const fixed = (v) => Number(v).toFixed(1);
const signed = (v) => `${v < 0 ? "" : "+"}${fixed(v)}`;
const list = (items) =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
const level = (v, unit) => (v == null ? "silent" : `${fixed(v)} ${unit}`);
export function renderText(operation, r) {
  if (["frames", "screenshot"].includes(operation)) {
    const at = r.times
      ? `: ${r.times.length} frame${r.times.length === 1 ? "" : "s"}, at ${r.times.map(clock).join(", ")}`
      : "";
    return [
      r.path
        ? `Wrote ${r.path} (${r.bytes} bytes)${at}.`
        : `PNG${at}, ${r.bytes} bytes (base64 in the JSON result).`,
      ...(r.warnings ?? []).map((w) => `Warning: ${w}`),
    ].join("\n");
  }
  if (operation === "loudness") return loudnessText(r);
  let used = r.preset;
  if (/\.(m4a|wav)$/i.test(r.path)) used += ", sound only";
  else if ([r.width, r.height, r.codec, r.videoBitrate].every((v) => v != null)) {
    used += `: ${r.width}x${r.height} ${{ h264: "H.264", hevc: "HEVC", vp8: "VP8" }[r.codec] ?? r.codec} at ${Number((Math.round(r.videoBitrate / 100000) / 10).toFixed(1))} Mbps`;
    if (r.format) used += `, ${r.format} format`;
  }
  let text = `Wrote ${r.path} (${used}, ${clock(r.duration)} long) in ${fixed(r.elapsed)}s.`;
  if (r.integratedLUFS != null && r.truePeakDBTP != null) {
    text += ` Loudness ${fixed(r.integratedLUFS)} LUFS, true peak ${fixed(r.truePeakDBTP)} dBTP`;
    if (r.loudnessTarget != null) {
      text += ` (mastered to ${number(r.loudnessTarget)} LUFS`;
      if (r.truePeakCeiling != null) text += `, peaks under ${number(r.truePeakCeiling)} dBTP`;
      text += ")";
    }
    text += ".";
  }
  if (r.tracks)
    text += ` Only ${list(r.tracks)} ${r.tracks.length === 1 ? "plays" : "play"}, at the timeline's own level (not mastered).`;
  return [text, ...(r.warnings ?? []).map((w) => `Warning: ${w}`)].join("\n");
}
function spread(values) {
  const rounded = values.map((v) => (Math.sign(v) * Math.round(Math.abs(v) * 10)) / 10),
    low = Math.min(...rounded),
    high = Math.max(...rounded);
  if (low === high) return `${signed(low)} dB`;
  let text = `${signed(low)} to ${signed(high)} dB`;
  const counts = new Map();
  for (const v of rounded) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [common, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (count * 2 >= rounded.length) text += ` (${count} at ${signed(common)} dB)`;
  return text;
}
function loudnessText(r) {
  if (r.curve) return curveText(r).join("\n");
  const lines = [
    `Speech is levelled to ${fixed(r.speechLoudness)} LUFS; export brings the mix to ${fixed(r.target)} LUFS with true peaks under ${fixed(r.truePeakCeiling)} dBTP.`,
  ];
  if (!r.media.length) lines.push("No media with sound.");
  for (const m of r.media)
    lines.push(
      m.integratedLUFS != null && m.truePeakDBTP != null
        ? `  ${m.mediaID}  ${m.path}  ${fixed(m.integratedLUFS)} LUFS, peak ${fixed(m.truePeakDBTP)} dBTP, range ${fixed(m.loudnessRange ?? 0)} LU`
        : `  ${m.mediaID}  ${m.path}  not measured yet${m.state === "none" ? "" : ` (${m.state})`}`,
    );
  const groups = [],
    speech = r.clips.filter((c) => c.speech),
    unlevelled = speech.filter((c) => c.normalizeTo !== r.speechLoudness || c.gainDB !== 0);
  for (const c of r.clips.filter((clip) => clip.normalizeTo != null || clip.gainDB !== 0)) {
    let group = groups.find((g) => g.track === c.track && g.normalizeTo === c.normalizeTo);
    if (!group) {
      group = { track: c.track, normalizeTo: c.normalizeTo, gains: [], normal: [] };
      groups.push(group);
    }
    group.gains.push(c.gainDB);
    if (c.normalizeGainDB != null) group.normal.push(c.normalizeGainDB);
  }
  if (speech.length && unlevelled.length)
    lines.push(
      `${unlevelled.length} of ${speech.length} speech clips aren't at the speech level; normalizeSpeech sets them.`,
    );
  for (const track of new Set(
    r.clips.filter((c) => c.limiterCeiling != null).map((c) => c.track),
  )) {
    const held = r.clips.filter((c) => c.track === track && c.limiterCeiling != null),
      ceiling = Math.max(...held.map((c) => c.limiterCeiling)),
      peaks = held.filter((c) => c.peakDBTP != null).map((c) => c.peakDBTP);
    lines.push(
      held.length === 1
        ? `A limiter holds the 1 clip on ${track}${peaks.length ? `, which would peak at ${signed(peaks[0])} dBTP,` : ""} under ${fixed(ceiling)} dBFS.`
        : `Limiters hold ${held.length} clips on ${track}${peaks.length ? ` (they'd peak at up to ${signed(Math.max(...peaks))} dBTP)` : ""} under ${fixed(ceiling)} dBFS.`,
    );
  }
  const over = speech.filter(
    (c) =>
      !c.muted && c.limiterCeiling == null && c.peakDBTP != null && c.peakDBTP > r.truePeakCeiling,
  );
  if (over.length)
    lines.push(
      `${over.length === 1 ? "1 speech clip peaks" : `${over.length} speech clips peak`} over the ${fixed(r.truePeakCeiling)} dBTP ceiling once levelled (up to ${signed(Math.max(...over.map((c) => c.peakDBTP)))} dBTP), which export's limiter squashes; normalizeSpeech holds them with a compressor and a limiter.`,
    );
  if (groups.length) {
    lines.push("Clip levels by track (clip gain is added after levelling):");
    const width = Math.max(...groups.map((g) => g.track.length));
    for (const g of groups) {
      const parts = [
        `  ${g.track.padEnd(width)}`,
        `${g.gains.length} clip${g.gains.length === 1 ? "" : "s"}`,
      ];
      if (g.normalizeTo != null)
        parts.push(
          `levelled to ${fixed(g.normalizeTo)} LUFS ${g.normal.length ? `(${spread(g.normal)})` : "once measured"}`,
        );
      if (g.gains.some((v) => v !== 0)) parts.push(`gain ${spread(g.gains)}`);
      lines.push(parts.join("  "));
    }
  }
  return lines.join("\n");
}
function curveText(r) {
  const c = r.curve,
    lines = [
      `${r.tracks ? list(r.tracks) : "The mix"} from ${clock(c.start)} to ${clock(c.end)}, every ${number(c.step)} s, as the timeline plays it (export's master gain moves it all by the same amount).`,
    ];
  let summary = `Integrated ${level(c.integratedLUFS, "LUFS")}, true peak ${level(c.truePeakDBTP, "dBTP")}.`;
  const measured = c.points.filter((p) => p.momentaryLUFS != null);
  if (measured.length) {
    const loudest = measured.reduce((a, b) => (a.momentaryLUFS >= b.momentaryLUFS ? a : b));
    summary += ` Loudest: ${level(loudest.momentaryLUFS, "LUFS")} momentary at ${clock(loudest.time)}.`;
  }
  lines.push(summary);
  let values = c.points.map((p) => p.shortTermLUFS);
  if (values.length > 200)
    values = Array.from({ length: 200 }, (_, i) => {
      const chunk = values
        .slice(Math.floor((i * values.length) / 200), Math.floor(((i + 1) * values.length) / 200))
        .filter((v) => v != null);
      return chunk.length ? Math.max(...chunk) : null;
    });
  lines.push(
    "Short-term: " +
      values
        .map((v) =>
          v == null ? "·" : "▁▂▃▄▅▆▇█"[Math.max(0, Math.min(7, Math.round(((v + 60) / 50) * 7)))],
        )
        .join(""),
  );
  if (r.peaks) {
    const p = r.peaks;
    if (!p.windows) lines.push(`No window peaks over ${fixed(p.threshold)} dBFS.`);
    else {
      lines.push(
        `${p.windows} window${p.windows === 1 ? " peaks" : "s peak"} over ${fixed(p.threshold)} dBFS, in ${p.stretches.length} stretch${p.stretches.length === 1 ? "" : "es"}:`,
      );
      for (const s of p.stretches.slice(0, 200))
        lines.push(
          `  ${clock(s.start)}-${clock(s.end)}  peak ${fixed(s.peakDBFS)} dBFS (${s.windows} window${s.windows === 1 ? "" : "s"})`,
        );
      if (p.stretches.length > 200)
        lines.push(`And ${p.stretches.length - 200} more; --json lists them all.`);
      lines.push("A window is the 400 ms centred on a row; its peak is its highest sample.");
    }
  } else if (c.points.length > 2000)
    lines.push(
      `${c.points.length} rows: --json gives every one, and --over <dBFS> lists the stretches that peak over a level.`,
    );
  else {
    lines.push("  time        momentary   short-term  peak");
    for (const p of c.points)
      lines.push(
        `  ${clock(p.time)}   ${level(p.momentaryLUFS, "LUFS").padEnd(10)}  ${level(p.shortTermLUFS, "LUFS").padEnd(10)}  ${p.peakDBFS == null ? "" : `${fixed(p.peakDBFS)} dBFS`}`.trimEnd(),
      );
    lines.push(
      "Momentary is the 400 ms centred on each time, short-term the 3 s, peak the highest sample in the 400 ms.",
    );
  }
  if (r.gains) {
    lines.push(`Gain lanes against the render, ${clock(c.start)} to ${clock(c.end)}:`);
    if (!r.gains.length) lines.push("  No audio track plays here.");
    const width = Math.max(0, ...r.gains.map((g) => g.track.length));
    for (const g of r.gains) {
      const name = `  ${g.track.padEnd(width)}  `;
      if (!g.compared) {
        lines.push(name + "nothing to compare (silent, or only crossfades)");
        continue;
      }
      if (!g.mismatches.length && g.lateBy == null) {
        lines.push(
          name +
            `follows its lane (${number(Math.round(g.compared * 10) / 10)} s compared, within ${fixed(g.worstDB ?? 0)} dB)`,
        );
        continue;
      }
      const parts = [];
      if (g.lateBy != null)
        parts.push(
          `lands ${Math.round(Math.abs(g.lateBy) * 1000)} ms ${g.lateBy > 0 ? "late" : "early"}`,
        );
      if (g.mismatches.length) parts.push("plays off its lane at:");
      lines.push(name + parts.join("; "));
      for (const m of g.mismatches)
        lines.push(
          `    ${clock(m.start)}-${clock(m.end)}  the lane says ${fixed(m.expectedDB)} dB, the render plays ${fixed(m.measuredDB)} dB`,
        );
    }
  }
  return lines;
}
