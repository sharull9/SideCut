// Ported from TandemCore/Editing.swift (setFormatLayout, adoptFormat), TandemCore/Layout.swift,
// TandemRender/LayerMath.swift and TandemAPI/Short.swift. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { Clip, Project } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import { replace, requireClip, unlocked, type EditContext } from "./timeline-editing";

type Json = Record<string, unknown>;
export const isObject = (v: unknown): v is Json =>
  !!v && typeof v === "object" && !Array.isArray(v);
export type PortraitSlot = "top" | "bottom" | "full";
export const PORTRAIT = { id: "portrait", name: "Short (9:16)", width: 1080, height: 1920 };
const bands: Record<PortraitSlot, [number, number]> = {
  top: [0, 0.5],
  bottom: [0.5, 1],
  full: [0, 1],
};

/** Fills a full-width band of the canvas with the source, cropping its sides (cover, not fit). */
export function fillingTransform(
  slot: PortraitSlot,
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
) {
  const fit = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const [top, bottom] = bands[slot];
  const scale = Math.max(
    canvasWidth / (sourceWidth * fit),
    ((bottom - top) * canvasHeight) / (sourceHeight * fit),
  );
  return { position: { x: 0.5, y: (top + bottom) / 2 }, scale, rotation: 0 };
}

export const mediaIDOf = (clip: Clip) => {
  const media = clip.content.media as { mediaID?: unknown } | undefined;
  return typeof media?.mediaID === "string" ? media.mediaID : null;
};
const overridesOf = (clip: Clip): Json =>
  isObject(clip.video?.formatOverrides) ? (clip.video.formatOverrides as Json) : {};

/**
 * Video properties for an output format: an override's transform or crop replaces the main
 * one, and the keyframes that animate it are ignored there. Null when hidden in the format.
 */
export function clipInFormat(clip: Clip, format: string | null | undefined): Clip | null {
  if (!format) return clip;
  const override = overridesOf(clip)[format];
  if (!isObject(override)) return clip;
  if (override.hidden === true) return null;
  const video: Json = { ...(clip.video ?? {}) };
  const keyframes = { ...clip.keyframes };
  if (isObject(override.transform)) {
    video.transform = override.transform;
    for (const key of Object.keys(keyframes))
      if (key.startsWith("video.transform.")) delete keyframes[key];
  }
  if (isObject(override.crop)) {
    video.crop = override.crop;
    for (const key of Object.keys(keyframes))
      if (key.startsWith("video.crop.")) delete keyframes[key];
  }
  if (typeof override.cutout === "boolean" && isObject(video.cutout))
    video.cutout = { ...video.cutout, enabled: override.cutout };
  return { ...clip, video, keyframes } as unknown as Clip;
}
export const isHiddenIn = (clip: Clip, format: string | null | undefined) =>
  !!format &&
  isObject(overridesOf(clip)[format]) &&
  (overridesOf(clip)[format] as Json).hidden === true;
export const formatOf = (project: Project, id: string | null | undefined) =>
  id ? (project.settings.alternateFormats.find((f) => f.id === id) ?? null) : null;

export const number = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

export function editFormats(
  p: Project,
  command: EditCommand,
  context: EditContext,
): Project | null {
  if ("setFormatLayout" in command) {
    const { clipIDs, format, slot, cutout } = command.setFormatLayout;
    const output = formatOf(p, format);
    if (!output)
      throw new Error(
        `Output format ${format} not found; add it to settings.alternateFormats first.`,
      );
    for (const id of clipIDs) {
      const { track, clip } = requireClip(p, id);
      if (track.kind !== "video") continue;
      unlocked(track);
      // Stills, text and solids without a known size fill as the canvas.
      let width = p.settings.width,
        height = p.settings.height;
      const item = p.media.find((m) => m.id === mediaIDOf(clip));
      if (item?.width && item.height) {
        width = item.width;
        height = item.height;
      }
      const overrides = overridesOf(clip);
      const previous = isObject(overrides[format]) ? (overrides[format] as Json) : {};
      const next: Json = {
        ...previous,
        transform: fillingTransform(slot, width, height, output.width, output.height),
        crop: { left: 0, top: 0, right: 0, bottom: 0 },
        hidden: false,
        ...(cutout != null ? { cutout } : {}),
      };
      const video = { ...(clip.video ?? {}), formatOverrides: { ...overrides, [format]: next } };
      p = replace(p, {
        ...track,
        clips: track.clips.map((c) => (c.id === id ? ({ ...c, video } as unknown as Clip) : c)),
      });
    }
    return p;
  }
  if (!("adoptFormat" in command)) return null;
  const { format } = command.adoptFormat;
  const output = formatOf(p, format);
  if (!output) throw new Error(`Output format ${format} not found in settings.alternateFormats.`);
  const dropped: string[] = [];
  const transformPaths = [
    "video.transform.position",
    "video.transform.scale",
    "video.transform.rotation",
  ];
  p = {
    ...p,
    videoTracks: p.videoTracks.map((track) => ({
      ...track,
      clips: track.clips.map((original) => {
        const overrides = overridesOf(original);
        const override = overrides[format];
        if (!original.video || !isObject(override)) return original;
        const { [format]: _adopted, ...rest } = overrides;
        const video: Json = { ...original.video, formatOverrides: rest };
        const clip = { ...original } as { -readonly [K in keyof Clip]: Clip[K] };
        const keyframes = { ...clip.keyframes };
        if (override.hidden === true) clip.enabled = false;
        if (isObject(override.transform)) {
          const main = isObject(video.transform) ? video.transform : {};
          const target = override.transform;
          if (keyframes["video.transform.position"] != null) {
            // A pan or zoom: the format never showed it and a landscape move doesn't fit there.
            for (const path of transformPaths) delete keyframes[path];
            dropped.push(clip.name ?? clip.id);
          } else {
            // Keyframes are absolute, so a pop from the landscape size scales to the format's.
            const mainScale = number(main.scale, 1);
            const scale = keyframes["video.transform.scale"];
            if (scale && mainScale > 0) {
              const factor = number(target.scale, 1) / mainScale;
              keyframes["video.transform.scale"] = scale.map((frame) =>
                typeof frame.value === "number" ? { ...frame, value: frame.value * factor } : frame,
              );
            }
            const rotation = keyframes["video.transform.rotation"];
            if (rotation) {
              const delta = number(target.rotation, 0) - number(main.rotation, 0);
              keyframes["video.transform.rotation"] = rotation.map((frame) =>
                typeof frame.value === "number" ? { ...frame, value: frame.value + delta } : frame,
              );
            }
          }
          video.transform = target;
          delete video.layoutPreset;
        }
        if (isObject(override.crop)) {
          video.crop = override.crop;
          for (const key of Object.keys(keyframes))
            if (key.startsWith("video.crop.")) delete keyframes[key];
        }
        if (typeof override.cutout === "boolean" && isObject(video.cutout))
          video.cutout = { ...video.cutout, enabled: override.cutout };
        return { ...clip, video, keyframes } as unknown as Clip;
      }),
    })),
    settings: {
      ...p.settings,
      width: output.width,
      height: output.height,
      alternateFormats: p.settings.alternateFormats.filter((f) => f.id !== format),
    },
  };
  if (dropped.length)
    context.warn(
      `Dropped the zoom on ${dropped.join(", ")}: the ${output.name} format never showed it, and a landscape pan doesn't fit there. Zoom again with zoomToRegion if you want one.`,
    );
  return p;
}

export const isNineBySixteen = (width: number, height: number) =>
  width > 0 && height > 0 && Math.abs(width / height - 9 / 16) < 0.005;

/** Camera in the bottom half (or full frame when the edit shows it full); everything else on top. */
export function portraitSlot(clip: Clip, role: string): PortraitSlot {
  if (role !== "camera") return "top";
  const video = clip.video ?? {};
  const transform = isObject(video.transform) ? video.transform : {};
  const cutoutOn = isObject(video.cutout) && video.cutout.enabled === true;
  if (video.layoutPreset === "full" || (number(transform.scale, 1) >= 0.99 && !cutoutOn))
    return "full";
  return "bottom";
}

/**
 * The project as an alternate format renders it: the format's canvas, each clip's override
 * applied and clips hidden there switched off. The main format returns the project unchanged.
 */
export function formatProject(project: Project, format: string | null | undefined): Project {
  const output = formatOf(project, format);
  if (!output) return project;
  return {
    ...project,
    settings: { ...project.settings, width: output.width, height: output.height },
    videoTracks: project.videoTracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => clipInFormat(clip, format) ?? { ...clip, enabled: false }),
    })),
  };
}
