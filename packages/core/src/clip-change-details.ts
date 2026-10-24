// Ported from TandemCore/EditHistory.swift at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip } from "@sidecut/contracts/project";
import { object as requiredObject } from "./import-builder";
const object = (value: unknown) => (value == null ? {} : requiredObject(value));
import { queryClock } from "./timeline-dump";

const near = (a: number, b = 0) => Math.abs(a - b) < 0.0005;
const number = (v: unknown) => String(Math.round(Number(v) * 10000) / 10000);
const signed = (v: number) => `${v < 0 ? "-" : "+"}${Math.abs(v).toFixed(3)}s`;
const seconds = (v: unknown) => `${Number(v).toFixed(3)}s`;
const quoted = (v: unknown) => {
  if (v == null) return "none";
  const text = String(v).replaceAll("\n", " / ");
  return `"${text.length > 32 ? text.slice(0, 29) + "..." : text}"`;
};
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function sameClip(a: Clip, b: Clip) {
  return (
    near(a.start.seconds, b.start.seconds) &&
    near(a.duration.seconds, b.duration.seconds) &&
    near(a.sourceStart.seconds, b.sourceStart.seconds) &&
    equal(a, { ...b, start: a.start, duration: a.duration, sourceStart: a.sourceStart })
  );
}
export function changeContent(clip: Clip, names: Map<string, string>): string {
  const media = object(clip.content.media).mediaID;
  if (typeof media === "string") return names.get(media) ?? media;
  if (clip.content.text) {
    const text = String(object(clip.content.text).text ?? "").replaceAll("\n", " / ");
    return `text "${text.length > 40 ? text.slice(0, 37) + "..." : text}"`;
  }
  if (clip.content.graphic) {
    const template = object(clip.content.graphic).template;
    return template === "sectionCard" ? "section card" : `graphic ${String(template)}`;
  }
  return clip.content.solid ? "solid" : "adjustment";
}
function effects(a: unknown, b: unknown, what: string) {
  const before = Array.isArray(a) ? a.map(object) : [],
    after = Array.isArray(b) ? b.map(object) : [];
  const parts = [
    ...after.filter((f) => !before.some((g) => g.id === f.id)).map((f) => `+${String(f.type)}`),
    ...before.filter((f) => !after.some((g) => g.id === f.id)).map((f) => `-${String(f.type)}`),
  ];
  return parts.length ? `${what} ${parts.join(" ")}` : `${what} settings`;
}
export function changeDetails(
  a: Clip,
  b: Clip,
  wasTrack: string,
  track: string,
  movedTrack: boolean,
  names: Map<string, string>,
) {
  const details: string[] = [];
  let shift: number | undefined;
  if (movedTrack) details.push(`track ${wasTrack} -> ${track}`);
  const start = b.start.subtract(a.start).seconds,
    end = b.start.add(b.duration).subtract(a.start.add(a.duration)).seconds,
    source = b.sourceStart.subtract(a.sourceStart).seconds;
  if (near(start, end) && !near(start) && near(source)) {
    details.push(`moved ${signed(start)}`);
    shift = start;
  } else if (
    a.speed === b.speed &&
    !b.freezeFrame &&
    near(start) &&
    !near(source) &&
    near(end, -source / b.speed)
  )
    details.push(`start trimmed ${signed(source / b.speed)}, rippled`);
  else {
    if (!near(start)) details.push(`start ${signed(start)}`);
    if (!near(end)) details.push(`end ${signed(end)}`);
    const slip = a.speed === b.speed ? source - start * b.speed : 0;
    if (!near(slip) && !b.freezeFrame) details.push(`slipped ${signed(slip)}`);
  }
  if (a.speed !== b.speed) details.push(`speed ${number(a.speed)} -> ${number(b.speed)}`);
  for (const [key, on, off] of [
    ["enabled", "turned on", "turned off"],
    ["freezeFrame", "freeze frame on", "freeze frame off"],
    ["holdEdges", "holds its edges", "stops holding its edges"],
  ] as const)
    if (a[key] !== b[key]) details.push(b[key] ? on : off);
  if (!equal(a.content, b.content)) {
    const am = object(a.content.media).mediaID,
      bm = object(b.content.media).mediaID;
    details.push(
      typeof am === "string" && typeof bm === "string"
        ? `media ${names.get(am) ?? am} -> ${names.get(bm) ?? bm}`
        : a.content.text && b.content.text
          ? object(a.content.text).text === object(b.content.text).text
            ? "title style"
            : `text ${quoted(object(a.content.text).text)} -> ${quoted(object(b.content.text).text)}`
          : a.content.graphic && b.content.graphic
            ? "graphic settings"
            : `content ${changeContent(a, names)} -> ${changeContent(b, names)}`,
    );
  }
  if (a.name !== b.name) details.push(`name ${quoted(a.name)} -> ${quoted(b.name)}`);
  if (a.linkGroup !== b.linkGroup)
    details.push(!a.linkGroup ? "linked" : !b.linkGroup ? "unlinked" : "linked to other clips");
  if (!equal(a.video, b.video)) {
    const x = object(a.video),
      y = object(b.video),
      xt = object(x.transform),
      yt = object(y.transform),
      xp = { x: 0.5, y: 0.5, ...object(xt.position) },
      yp = { x: 0.5, y: 0.5, ...object(yt.position) };
    const before = details.length;
    if (!equal(xp, yp))
      details.push(`position ${number(xp.x)},${number(xp.y)} -> ${number(yp.x)},${number(yp.y)}`);
    for (const [key, defaultValue] of [
      ["scale", 1],
      ["rotation", 0],
    ] as const)
      if ((xt[key] ?? defaultValue) !== (yt[key] ?? defaultValue))
        details.push(
          `${key} ${number(xt[key] ?? defaultValue)} -> ${number(yt[key] ?? defaultValue)}`,
        );
    if (!equal(x.crop, y.crop)) details.push("crop");
    if ((x.opacity ?? 1) !== (y.opacity ?? 1))
      details.push(`opacity ${number(x.opacity ?? 1)} -> ${number(y.opacity ?? 1)}`);
    if (!equal(x.cutout, y.cutout))
      details.push(!x.cutout ? "cutout on" : !y.cutout ? "cutout off" : "cutout settings");
    if (!equal(x.effects, y.effects)) details.push(effects(x.effects, y.effects, "effects"));
    if (x.layoutPreset !== y.layoutPreset)
      details.push(
        `layout ${String(x.layoutPreset ?? "none")} -> ${String(y.layoutPreset ?? "none")}`,
      );
    if (!equal(x.formatOverrides, y.formatOverrides))
      details.push(
        `placement in ${[
          ...new Set([
            ...Object.keys(object(x.formatOverrides)),
            ...Object.keys(object(y.formatOverrides)),
          ]),
        ]
          .filter((k) => !equal(object(x.formatOverrides)[k], object(y.formatOverrides)[k]))
          .sort()
          .join(", ")}`,
      );
    if (details.length === before) details.push("picture settings");
  }
  if (!equal(a.audio, b.audio)) {
    const x = object(a.audio),
      y = object(b.audio),
      before = details.length;
    if ((x.gainDB ?? 0) !== (y.gainDB ?? 0))
      details.push(`gain ${number(x.gainDB ?? 0)} -> ${number(y.gainDB ?? 0)} dB`);
    for (const [key, label] of [
      ["fadeIn", "fade in"],
      ["fadeOut", "fade out"],
    ] as const)
      if (!near(Number(x[key] ?? 0), Number(y[key] ?? 0)))
        details.push(`${label} ${seconds(x[key] ?? 0)} -> ${seconds(y[key] ?? 0)}`);
    if ((x.muted ?? false) !== (y.muted ?? false)) details.push(y.muted ? "muted" : "unmuted");
    if (x.normalizeTo !== y.normalizeTo)
      details.push(
        `level ${x.normalizeTo == null ? "off" : `${number(x.normalizeTo)} LUFS`} -> ${y.normalizeTo == null ? "off" : `${number(y.normalizeTo)} LUFS`}`,
      );
    if ((x.voiceIsolation ?? 0) !== (y.voiceIsolation ?? 0))
      details.push(
        `voice isolation ${number(x.voiceIsolation ?? 0)} -> ${number(y.voiceIsolation ?? 0)}`,
      );
    if (!equal(x.effects, y.effects)) details.push(effects(x.effects, y.effects, "audio effects"));
    if (details.length === before) details.push("sound settings");
  }
  for (const key of [
    ...new Set([...Object.keys(a.keyframes), ...Object.keys(b.keyframes)]),
  ].sort()) {
    const x = a.keyframes[key] ?? [],
      y = b.keyframes[key] ?? [];
    if (!equal(x, y))
      details.push(
        !x.length
          ? `keyframes ${key} (${y.length})`
          : !y.length
            ? `keyframes ${key} removed`
            : x.length === y.length
              ? `keyframes ${key} changed`
              : `keyframes ${key} (${x.length} -> ${y.length})`,
      );
  }
  if (!equal(a.tags, b.tags)) details.push(`tags ${a.tags.join(",")} -> ${b.tags.join(",")}`);
  if (!details.length) details.push("settings");
  return { details, ...(shift != null && details.length === 1 && !movedTrack ? { shift } : {}) };
}
export { near, queryClock };
