// Ported from TandemAPI/TimelineDump.swift at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip, Project, ProjectFile } from "@sidecut/contracts/project";
import { object } from "./import-builder";
import { projectDuration } from "./render-plan";
import { speechTracks, unionRanges, type Transcripts } from "./speech";
import { placeWords } from "./transcript";
export function queryTracks(project: Project) {
  return [
    ...project.videoTracks
      .map((track, i) => ({ track, label: `V${i + 1} ${track.name}` }))
      .reverse(),
    ...project.audioTracks.map((track, i) => ({ track, label: `A${i + 1} ${track.name}` })),
  ];
}
export const queryClock = (seconds: number) => {
  const ms = Math.round(Math.abs(seconds) * 1000);
  return `${seconds < 0 ? "-" : ""}${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
const length = (seconds: number) =>
  Math.abs(seconds) < 60 ? `${seconds.toFixed(3)}s` : queryClock(seconds);
function commandNumber(value: number) {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const rounded = Number(value.toPrecision(6));
  const exponent = rounded === 0 ? 0 : Math.floor(Math.log10(Math.abs(rounded)));
  if (exponent >= 6 || exponent < -4) {
    const [mantissa, power] = rounded.toExponential(5).split("e");
    const p = Number(power);
    return `${Number(mantissa)}e${p < 0 ? "-" : "+"}${String(Math.abs(p)).padStart(2, "0")}`;
  }
  return String(rounded);
}
const num = (value: unknown, precision = 1000) => {
  const n = Number(value);
  return commandNumber((Math.sign(n) * Math.round(Math.abs(n) * precision)) / precision);
};
const base = (path: string) => path.split(/[\\/]/).at(-1)!;
const shortened = (text: string, limit: number) =>
  Array.from(text).length <= limit
    ? text
    : Array.from(text)
        .slice(0, limit - 3)
        .join("") + "...";
const mediaID = (clip: Clip) =>
  clip.content.media ? String(object(clip.content.media).mediaID) : undefined;
const hex = (value: unknown) => {
  const color = object(value);
  return (
    "#" +
    [color.r, color.g, color.b]
      .map((c) =>
        Math.round(Math.min(1, Math.max(0, Number(c))) * 255)
          .toString(16)
          .padStart(2, "0")
          .toUpperCase(),
      )
      .join("") +
    (Number(color.a ?? 1) < 1 ? ` at ${num(color.a)}` : "")
  );
};
function namesFor(project: Project) {
  const counts = new Map<string, number>();
  for (const m of project.media) counts.set(base(m.path), (counts.get(base(m.path)) ?? 0) + 1);
  return new Map(
    project.media.map((m) => [m.id, counts.get(base(m.path))! > 1 ? m.path : base(m.path)]),
  );
}
export function timelineContent(clip: Clip, project: Project, names = namesFor(project)) {
  const id = mediaID(clip);
  if (id) {
    const item = project.media.find((m) => m.id === id),
      name = names.get(id) ?? `${id} (missing)`;
    if (item?.kind === "image") return name;
    if (clip.freezeFrame) return `${name} frozen at ${queryClock(clip.sourceStart.seconds)}`;
    let result = `${name} [${queryClock(clip.sourceStart.seconds)}-${queryClock(clip.sourceStart.seconds + clip.duration.seconds * clip.speed)}]`;
    const holds: string[] = [];
    if (clip.holdEdges && item?.duration) {
      const head = Math.max(0, -clip.sourceStart.seconds / clip.speed),
        tail = Math.max(
          0,
          (clip.sourceStart.seconds + clip.duration.seconds * clip.speed - item.duration.seconds) /
            clip.speed,
        );
      if (head) holds.push(`first frame ${queryClock(head)}`);
      if (tail) holds.push(`last frame ${queryClock(tail)}`);
    }
    if (holds.length) result += " holds its " + holds.join(", ");
    return result;
  }
  if (clip.content.text) {
    const t = object(clip.content.text);
    return `text "${shortened(String(t.text).replaceAll("\n", " / "), 48)}"${t.preset ? ` ${String(t.preset)}` : ""}`;
  }
  if (clip.content.graphic) {
    const g = object(clip.content.graphic);
    if (g.template !== "sectionCard") return `graphic ${String(g.template)}`;
    const props = object(g.props ?? {});
    let result = `section card${props.number ? ` ${String(props.number)}` : ""} "${shortened(String(props.title ?? "").replaceAll("\n", " "), 40)}"`;
    if (props.subtitle) result += ` / "${shortened(String(props.subtitle), 32)}"`;
    if (props.index != null && Number(props.total) > 0)
      result += ` ${String(props.index)} of ${String(props.total)}`;
    if (props.kicker) result += ` kicker ${String(props.kicker)}`;
    if (props.cursor === false) result += " no cursor";
    return result;
  }
  return clip.content.solid
    ? `solid ${hex(object(clip.content.solid).color ?? clip.content.solid)}`
    : "adjustment";
}
function settings(
  clip: Clip,
  links: Map<string, number>,
  names: Map<string, string>,
  sounds: Map<string, string>,
) {
  const parts: string[] = [],
    id = mediaID(clip);
  if (sounds.has(clip.id)) parts.push(`sound of ${sounds.get(clip.id)!}`);
  if (clip.name && clip.name !== names.get(id ?? "")?.replace(/\.[^.]+$/, ""))
    parts.push(`named "${clip.name}"`);
  if (clip.linkGroup && links.has(clip.linkGroup))
    parts.push(`linked #${links.get(clip.linkGroup)!}`);
  if (!clip.enabled) parts.push("disabled");
  if (clip.speed !== 1) parts.push(`speed ${commandNumber(clip.speed)}x`);
  if (clip.video) {
    const v = clip.video,
      t = object(v.transform ?? {}),
      p = object(t.position ?? {});
    if (v.layoutPreset != null) parts.push(`layout ${String(v.layoutPreset)}`);
    const scale = Number(t.scale ?? 1),
      x = Number(p.x ?? 0.5),
      y = Number(p.y ?? 0.5);
    if (scale !== 1 || x !== 0.5 || y !== 0.5)
      parts.push(`scale ${num(scale)}${x !== 0.5 || y !== 0.5 ? ` at ${num(x)},${num(y)}` : ""}`);
    if (Number(t.rotation ?? 0)) parts.push(`rotated ${num(t.rotation)}`);
    const crop = object(v.crop ?? {}),
      edges = [
        ["l", crop.left],
        ["t", crop.top],
        ["r", crop.right],
        ["b", crop.bottom],
      ].filter(([, n]) => Number(n ?? 0) !== 0);
    if (edges.length)
      parts.push("crop " + edges.map(([key, value]) => `${String(key)}${num(value)}`).join(" "));
    if (Number(v.opacity ?? 1) !== 1) parts.push(`opacity ${num(v.opacity)}`);
    const cutout = object(v.cutout ?? {});
    if (cutout.enabled === true)
      parts.push((cutout.mode ?? "person") === "person" ? "cutout person" : "cutout");
    if (Array.isArray(v.effects) && v.effects.length)
      parts.push(
        "fx " +
          v.effects
            .map((e) => {
              const fx = object(e);
              return String(fx.type) + (fx.enabled === false ? "(off)" : "");
            })
            .join(","),
      );
    if (v.formatOverrides && Object.keys(object(v.formatOverrides)).length)
      parts.push("formats " + Object.keys(object(v.formatOverrides)).sort().join(","));
  }
  if (clip.audio) {
    const a = clip.audio;
    if (a.muted) parts.push("muted");
    if (Number(a.gainDB ?? 0)) parts.push(`gain ${num(a.gainDB, 10)} dB`);
    if (a.normalizeTo != null) parts.push(`level ${num(a.normalizeTo, 10)} LUFS`);
    if (Number(a.fadeIn ?? 0) > 0) parts.push(`fade in ${length(Number(a.fadeIn))}`);
    if (Number(a.fadeOut ?? 0) > 0) parts.push(`fade out ${length(Number(a.fadeOut))}`);
    if (Number(a.voiceIsolation ?? 0) > 0) parts.push(`isolate voice ${num(a.voiceIsolation)}`);
    if (Array.isArray(a.effects) && a.effects.length)
      parts.push(
        "fx " +
          a.effects
            .map((e) => {
              const fx = object(e);
              return String(fx.type) + (fx.enabled === false ? "(off)" : "");
            })
            .join(","),
      );
  }
  if (clip.content.text) {
    const t = object(clip.content.text),
      style = object(t.style ?? {});
    if (t.animationIn) parts.push(`in ${String(t.animationIn)}`);
    if (t.animationOut) parts.push(`out ${String(t.animationOut)}`);
    const fields: string[] = [];
    for (const key of [
      "font",
      "size",
      "weight",
      "color",
      "strokeColor",
      "strokeWidth",
      "backgroundColor",
      "alignment",
      "uppercase",
      "shadow",
      "lineSpacing",
    ])
      if (style[key] != null) {
        const value = style[key];
        fields.push(
          `${key}=${typeof value === "object" ? (key === "backgroundColor" && Number(object(value).a ?? 1) <= 0 ? "none" : hex(value)) : typeof value === "number" ? num(value) : String(value)}`,
        );
      }
    if (fields.length) parts.push("style " + fields.join(" "));
  }
  if (Object.keys(clip.keyframes).length)
    parts.push(
      "animates " +
        Object.keys(clip.keyframes)
          .sort()
          .map((key) =>
            key.replace("video.transform.", "").replace("video.", "").replace("audio.", ""),
          )
          .join(","),
    );
  if (clip.tags.length) parts.push(clip.tags.map((tag) => `#${tag}`).join(" "));
  return parts;
}
export function timelineText(
  file: ProjectFile,
  options: { from: number | null; to: number | null; summary: boolean; transcripts?: Transcripts },
) {
  const { project, revision } = file,
    duration = projectDuration(project).seconds,
    tracks = queryTracks(project),
    s = project.settings;
  const lines = [
    `${project.name}: ${queryClock(duration)} long, ${s.width}x${s.height} at ${commandNumber(s.frameRate.numerator / s.frameRate.denominator)} fps, revision ${revision}`,
  ];
  const overlaps = (start: number, end: number) =>
    (options.from == null || end > options.from) && (options.to == null || start < options.to);
  const range = options.from != null || options.to != null;
  if (options.summary)
    lines.push(
      `${tracks.length} tracks, ${tracks.reduce((sum, { track }) => sum + track.clips.length, 0)} clips, ${project.media.length} media files. Read part of it in full with from and to.`,
    );
  else {
    if (range)
      lines.push(
        `Showing ${queryClock(options.from ?? 0)} to ${options.to == null ? "the end" : queryClock(options.to)}: clips that overlap it, at their full length.`,
      );
    lines.push(
      "Tracks top to bottom as the app shows them. cut tracks hold the take and ripple edits cut them together; follow tracks move with them; off tracks stay put.",
      "Clips: ID, start-end on the timeline, length, content [source in-out of the file], then settings that aren't the defaults.",
    );
  }
  const markers = project.markers.filter(
    (m) => options.summary || overlaps(m.time, m.time + Math.max(m.duration, 1 / 705600000)),
  );
  if (markers.length) {
    lines.push("", "Markers");
    for (const m of markers)
      lines.push(
        `  ${queryClock(m.time)}${!options.summary && m.duration > 0 ? `-${queryClock(m.time + m.duration)}` : ""}  ${m.kind}  "${m.name}"${!options.summary && m.note ? ` (${m.note})` : ""}  ${m.id}`,
      );
  }
  if (options.summary) {
    lines.push("", "Tracks, top to bottom");
    const table = tracks.map(({ track, label }) => {
      const row = [label, track.id, track.rippleMode];
      if (!track.clips.length) row.push("empty", "", "");
      else {
        const covered = unionRanges(
          track.clips.map((c) => ({
            start: c.start.seconds,
            end: c.start.seconds + c.duration.seconds,
          })),
        );
        row.push(
          `${track.clips.length} clip${track.clips.length === 1 ? "" : "s"}`,
          `${queryClock(track.clips[0]!.start.seconds)}-${queryClock(Math.max(...track.clips.map((c) => c.start.seconds + c.duration.seconds)))}`,
          `${length(covered.reduce((sum, r) => sum + r.end - r.start, 0))} of content`,
        );
        if (track.rippleMode === "cut" && covered.length > 1)
          row.push(`${covered.length - 1} gap${covered.length === 2 ? "" : "s"}`);
        if (track.transitions.length)
          row.push(
            `${track.transitions.length} transition${track.transitions.length === 1 ? "" : "s"}`,
          );
      }
      for (const flag of ["locked", "hidden", "muted"] as const) if (track[flag]) row.push(flag);
      return row;
    });
    const widths = Array.from({ length: 6 }, (_, i) =>
      Math.max(0, ...table.map((row) => Array.from(row[i] ?? "").length)),
    );
    for (const row of table)
      lines.push(
        (
          "  " +
          row
            .map((cell, i) =>
              i < 5 ? cell + " ".repeat(Math.max(0, widths[i]! - Array.from(cell).length)) : cell,
            )
            .join("  ")
        ).trimEnd(),
      );
    return lines.join("\n") + "\n";
  }
  const shown = tracks.map((t) => ({
    ...t,
    clips: t.track.clips.filter((c) =>
      overlaps(c.start.seconds, c.start.seconds + c.duration.seconds),
    ),
  }));
  const links = new Map<string, number>();
  const ordered = shown
    .flatMap((t, order) => t.clips.map((clip) => ({ clip, order })))
    .sort((a, b) => a.clip.start.seconds - b.clip.start.seconds || a.order - b.order);
  for (const { clip } of ordered)
    if (clip.linkGroup && !links.has(clip.linkGroup)) links.set(clip.linkGroup, links.size + 1);
  const all = shown.flatMap((t) => t.clips),
    idWidth = Math.max(0, ...all.map((c) => c.id.length)) || 13,
    lengthWidth = Math.max(0, ...all.map((c) => length(c.duration.seconds).length)) || 7;
  const names = namesFor(project),
    used = new Set<string>(),
    missing = new Set<string>(),
    speech = new Set(speechTracks(project).map((t) => t.id)),
    sounds = new Map<string, string>();
  for (const { track } of tracks)
    for (const transition of track.transitions)
      if (typeof transition.soundClipID === "string" && !sounds.has(transition.soundClipID))
        sounds.set(transition.soundClipID, String(transition.id));
  const transitionText = (t: (typeof project.videoTracks)[number]["transitions"][number]) =>
    `${String(t.type)}${t.direction ? ` ${String(t.direction)}` : ""} ${length(Number(t.duration))}`;
  const soundText = (t: (typeof project.videoTracks)[number]["transitions"][number]) =>
    t.soundClipID ? `  sound ${String(t.soundClipID)}` : "";
  for (const { track, label, clips } of shown) {
    lines.push("");
    const flags: string[] = [track.rippleMode];
    for (const flag of ["locked", "hidden", "muted", "solo"] as const)
      if (track[flag]) flags.push(flag);
    if (!track.targeted) flags.push("untargeted");
    const own = clips.map((c) => settings(c, links, names, sounds)),
      counts = new Map<string, number>();
    if (clips.length >= 4)
      for (const row of own)
        for (const setting of new Set(row))
          if (!/^(linked #|named )/.test(setting))
            counts.set(setting, (counts.get(setting) ?? 0) + 1);
    const usual = [...new Set(own.flat())].filter(
      (setting) => (counts.get(setting) ?? 0) >= Math.ceil(clips.length * 0.6),
    );
    lines.push(
      `${label}  ${track.id}  ${flags.join(" ")}${usual.length ? `  (most clips: ${usual.join(", ")})` : ""}`,
    );
    if (!clips.length) {
      lines.push(range ? "  (nothing here in this range)" : "  (empty)");
      continue;
    }
    const spoken = new Map<string, ReturnType<typeof placeWords>>(),
      ready = new Set<string>();
    if (options.transcripts && speech.has(track.id)) {
      const byMedia = new Map<string, Clip[]>();
      for (const c of track.clips) {
        const id = mediaID(c);
        if (id && ((c.enabled && c.audio?.muted !== true && !c.freezeFrame) || clips.includes(c)))
          byMedia.set(id, [...(byMedia.get(id) ?? []), c]);
      }
      for (const [id, group] of byMedia) {
        const item = project.media.find((m) => m.id === id),
          transcript = item?.hasAudio ? options.transcripts(item) : undefined;
        if (!transcript) continue;
        ready.add(id);
        for (const word of placeWords(transcript, group, { includeDisabled: true }))
          spoken.set(word.clipID, [...(spoken.get(word.clipID) ?? []), word]);
      }
    }
    let previous: number | null = range ? null : 0;
    for (const [index, c] of clips.entries()) {
      if (track.rippleMode === "cut" && previous != null && c.start.seconds > previous)
        lines.push(
          `    gap ${queryClock(previous)}-${queryClock(c.start.seconds)} (${length(c.start.seconds - previous)})`,
        );
      const head = track.transitions.find((t) => t.fromClipID == null && t.toClipID === c.id),
        tail = track.transitions.find((t) => t.fromClipID === c.id);
      if (head)
        lines.push(`    ~ ${transitionText(head)} in  ${String(head.id)}${soundText(head)}`);
      const list = own[index]!,
        kinds = new Set(list.map((v) => v.split(" ")[0])),
        omitted = usual.filter((v) => !list.includes(v) && !kinds.has(v.split(" ")[0]));
      const parts = [
        `  ${c.id.padEnd(idWidth)}`,
        `${queryClock(c.start.seconds)}-${queryClock(c.start.seconds + c.duration.seconds)}`,
        length(c.duration.seconds).padStart(lengthWidth),
        timelineContent(c, project, names),
        ...list.filter((v) => !usual.includes(v)),
      ];
      if (omitted.length) parts.push("not: " + omitted.join(", "));
      lines.push(parts.join("  "));
      const id = mediaID(c);
      if (id) used.add(id);
      if (tail)
        lines.push(
          `    ~ ${transitionText(tail)}${tail.toClipID ? ` into ${String(tail.toClipID)}` : " out"}  ${String(tail.id)}${soundText(tail)}`,
        );
      if (
        options.transcripts &&
        speech.has(track.id) &&
        id &&
        project.media.find((m) => m.id === id)?.hasAudio
      ) {
        if (ready.has(id)) {
          const words = spoken.get(c.id) ?? [],
            selected = words.filter((w) => overlaps(w.start, w.end));
          let sentence = selected.map((w) => w.text).join(" ");
          if (sentence) {
            if (selected[0] !== words[0]) sentence = "..." + sentence;
            if (selected.at(-1) !== words.at(-1)) sentence += "...";
          }
          sentence = sentence ? `"${sentence}"` : "(no words)";
          let line = "";
          for (const word of sentence.split(" ")) {
            if (line && 6 + line.length + 1 + word.length > 100) {
              lines.push("      " + line);
              line = "";
            }
            line += (line ? " " : "") + word;
          }
          if (line) lines.push("      " + line);
        } else missing.add(id);
      }
      previous = c.start.seconds + c.duration.seconds;
    }
  }
  if (missing.size)
    lines.splice(
      range ? 4 : 3,
      0,
      `No transcript yet for ${[...missing].join(", ")}, so its clips show no words.`,
    );
  if (used.size) {
    lines.push("", "Media");
    const width = Math.max(...[...used].map((id) => id.length));
    for (const id of used) {
      const item = project.media.find((m) => m.id === id);
      if (!item) {
        lines.push(`  ${id}  (missing from the project)`);
        continue;
      }
      const row = [`  ${id.padEnd(width)}`, item.path, item.role];
      if (item.duration) row.push(queryClock(item.duration.seconds));
      if (item.width && item.height)
        row.push(
          `${item.width}x${item.height}${item.frameRate ? ` ${num(item.frameRate.numerator / item.frameRate.denominator, 100)}fps` : ""}`,
        );
      if (item.takeID) row.push(`take ${item.takeID} +${length(item.takeOffset?.seconds ?? 0)}`);
      lines.push(row.join("  "));
    }
  }
  return lines.join("\n") + "\n";
}
