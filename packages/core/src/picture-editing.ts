// Ported from TandemCore/Layout.swift and Editing.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip, Project } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import type { EditContext } from "./timeline-editing";
import { requireClip, unlocked, replace } from "./timeline-editing";
import { knownParameter, resolveClip } from "./keyframes";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Transform {
  position: { x: number; y: number };
  scale: number;
  rotation: number;
}
export const identity = (): Transform => ({ position: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0 });
export function transformOf(clip: Clip): Transform {
  const t = clip.video?.transform as Partial<Transform> | undefined;
  return { ...identity(), ...t, position: { ...identity().position, ...t?.position } };
}
export function sourceSize(p: Project, clip: Clip) {
  const media = p.media.find(
    (m) => m.id === (clip.content.media as { mediaID?: string } | undefined)?.mediaID,
  );
  return {
    width: media?.width ?? p.settings.width,
    height: media?.height ?? p.settings.height,
    media,
  };
}
export function regionTransform(
  rect: Rect,
  sw: number,
  sh: number,
  cw: number,
  ch: number,
): Transform {
  const fit = Math.min(cw / sw, ch / sh),
    w = sw * fit,
    h = sh * fit;
  const scale = Math.max(1, Math.min(cw / (rect.width * w), ch / (rect.height * h)));
  const halfW = (w * scale) / cw / 2,
    halfH = (h * scale) / ch / 2;
  let x = 0.5 - ((rect.x + rect.width / 2 - 0.5) * w * scale) / cw;
  let y = 0.5 - ((rect.y + rect.height / 2 - 0.5) * h * scale) / ch;
  if (halfW >= 0.5) x = Math.min(Math.max(x, 1 - halfW), halfW);
  if (halfH >= 0.5) y = Math.min(Math.max(y, 1 - halfH), halfH);
  return { position: { x, y }, scale, rotation: 0 };
}
export function motionEnds(
  base: Transform,
  style: string,
  amount: number,
  sw: number,
  sh: number,
  cw: number,
  ch: number,
) {
  const zoomed = { ...base, scale: base.scale * amount };
  if (style === "zoomIn") return [base, zoomed] as const;
  if (style === "zoomOut") return [zoomed, base] as const;
  const horizontal = style === "panLeft" || style === "panRight";
  const fit = Math.min(cw / sw, ch / sh);
  const overflow = (scale: number) =>
    Math.max(0, ((horizontal ? (sw * fit * scale) / cw : (sh * fit * scale) / ch) - 1) / 2);
  let start = base,
    room = overflow(base.scale);
  if (room < 0.02) {
    start = zoomed;
    room = overflow(zoomed.scale);
  }
  const travel = room * 0.8,
    direction = style === "panLeft" || style === "panUp" ? 1 : -1;
  const axis = horizontal ? "x" : "y";
  return [
    { ...start, position: { ...start.position, [axis]: 0.5 + travel * direction } },
    { ...start, position: { ...start.position, [axis]: 0.5 - travel * direction } },
  ] as const;
}
export function editPicture(
  p: Project,
  command: EditCommand,
  context: EditContext,
): Project | null {
  if ("setKeyframes" in command) {
    const { clipID, parameter, keyframes } = command.setKeyframes;
    const { track, clip } = requireClip(p, clipID);
    unlocked(track);
    if (!knownParameter(parameter))
      context.warn(
        `"${parameter}" isn't a known animatable parameter, so nothing will use these keyframes.`,
      );
    const frames = { ...clip.keyframes };
    if (!keyframes.length) delete frames[parameter];
    else
      frames[parameter] = [...keyframes]
        .sort((a, b) =>
          a.time.flicks < b.time.flicks ? -1 : a.time.flicks > b.time.flicks ? 1 : 0,
        )
        .map((k) => ({ ...k, time: k.time.toJSON() }));
    return replace(p, {
      ...track,
      clips: track.clips.map((c) => (c.id === clipID ? { ...clip, keyframes: frames } : c)),
    });
  }
  if ("applyLayout" in command || "addMotion" in command) {
    const body = "applyLayout" in command ? command.applyLayout : command.addMotion;
    if ("amount" in body && body.amount != null && (body.amount < 1 || body.amount > 3))
      throw new Error("Motion amount must be from 1 to 3. 1.12 is a gentle move.");
    let changed = 0;
    for (const id of body.clipIDs) {
      const { track, clip } = requireClip(p, id);
      if (track.kind !== "video") continue;
      unlocked(track);
      const size = sourceSize(p, clip),
        cw = p.settings.width,
        ch = p.settings.height;
      let video = { ...(clip.video ?? {}) },
        frames = { ...clip.keyframes };
      if ("preset" in body) {
        const { preset } = body;
        let transform = identity();
        const effects = (Array.isArray(video.effects) ? video.effects : []) as {
          id: string;
          type: string;
          [key: string]: unknown;
        }[];
        const cutout = video.cutout as Record<string, unknown> | undefined;
        const shadowID = context.makeID("fx");
        video = { ...video, layoutPreset: preset, crop: { left: 0, top: 0, right: 0, bottom: 0 } };
        if (preset === "pipRight" || preset === "pipLeft") {
          transform = {
            position: { x: preset === "pipRight" ? 0.87 : 0.13, y: 0.77 },
            scale: 0.5,
            rotation: 0,
          };
          video.cutout = {
            mode: "personAndProps",
            edgeFeather: 2,
            choke: 0,
            repairMasks: [],
            ...cutout,
            enabled: true,
          };
          video.effects = effects.some((f) => f.type === "dropShadow")
            ? (effects as NonNullable<Clip["video"]>[string])
            : ([
                ...effects,
                {
                  id: shadowID,
                  type: "dropShadow",
                  enabled: true,
                  params: { distance: 4, blur: 5, opacity: 60 },
                },
              ] as NonNullable<Clip["video"]>[string]);
        } else {
          if (cutout)
            video.cutout = { ...cutout, enabled: false } as NonNullable<Clip["video"]>[string];
          video.effects = effects.filter((f) => f.type !== "dropShadow") as NonNullable<
            Clip["video"]
          >[string];
          if (preset === "split") {
            transform.position.x = size.media?.role === "camera" ? 0.75 : 0.25;
            video.crop = { left: 0.25, top: 0, right: 0.25, bottom: 0 };
          }
          if (preset === "fill") {
            const fit = Math.min(cw / size.width, ch / size.height);
            transform.scale = Math.max(cw / (size.width * fit), ch / (size.height * fit));
          }
        }
        video.transform = transform as unknown as NonNullable<Clip["video"]>[string];
        for (const path of [
          "video.transform.position",
          "video.transform.scale",
          "video.transform.rotation",
        ])
          delete frames[path];
      } else {
        const [start, stop] = motionEnds(
          transformOf(clip),
          body.style,
          body.amount ?? 1.12,
          size.width,
          size.height,
          cw,
          ch,
        );
        frames["video.transform.scale"] = [
          { time: 0, value: start.scale, interpolation: "linear" },
          { time: clip.duration.toJSON(), value: stop.scale, interpolation: "linear" },
        ];
        frames["video.transform.position"] = [
          { time: 0, value: start.position, interpolation: "linear" },
          { time: clip.duration.toJSON(), value: stop.position, interpolation: "linear" },
        ];
      }
      p = replace(p, {
        ...track,
        clips: track.clips.map((c) => (c.id === id ? { ...clip, video, keyframes: frames } : c)),
      });
      changed++;
    }
    if (!changed) throw new Error("None of those clips are on a video track.");
    return p;
  }
  if ("zoomToRegion" in command) {
    const { clipID, rect, at, duration } = command.zoomToRegion;
    const { track, clip } = requireClip(p, clipID);
    unlocked(track);
    if (track.kind !== "video") throw new Error("Region zoom needs a picture clip.");
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.x < 0 ||
      rect.y < 0 ||
      rect.x + rect.width > 1.0001 ||
      rect.y + rect.height > 1.0001
    )
      throw new Error("The zoom rectangle must sit inside the source frame, from 0 to 1.");
    const size = sourceSize(p, clip);
    if (!size.media?.width || !size.media.height)
      throw new Error("Region zoom needs probed media width and height.");
    const target = regionTransform(
      rect,
      size.width,
      size.height,
      p.settings.width,
      p.settings.height,
    );
    const video = { ...(clip.video ?? {}) },
      frames = { ...clip.keyframes };
    delete video.layoutPreset;
    if (at == null) {
      video.transform = { ...transformOf(clip), position: target.position, scale: target.scale };
      delete frames["video.transform.position"];
      delete frames["video.transform.scale"];
    } else {
      const length = duration?.seconds ?? 0.5,
        start = at.seconds - clip.start.seconds,
        stop = start + length;
      if (length <= 0 || start < 0 || stop > clip.duration.seconds)
        throw new Error("The animated zoom must have positive duration inside the clip.");
      const from = transformOf(resolveClip(clip, at.seconds));
      for (const [path, a, b] of [
        ["video.transform.position", from.position, target.position],
        ["video.transform.scale", from.scale, target.scale],
      ] as const) {
        const list = (frames[path] ?? []).filter(
          (k) => Number(k.time) < start || Number(k.time) > stop,
        );
        if (!list.length && start > 0) list.push({ time: 0, value: a, interpolation: "hold" });
        list.push(
          { time: start, value: a, interpolation: "easeInOut" },
          { time: stop, value: b, interpolation: "easeInOut" },
        );
        frames[path] = list.sort((left, right) => Number(left.time) - Number(right.time));
      }
    }
    return replace(p, {
      ...track,
      clips: track.clips.map((c) => (c.id === clipID ? { ...clip, video, keyframes: frames } : c)),
    });
  }
  return null;
}
