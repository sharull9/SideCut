// Reference: TandemImport/Filmora/{FilmoraImporter,FilmoraMapping}.swift at 735a9b8.
// Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { object, list, number, text, type ObjectValue } from "./import-builder";
import type { Clip, ClipEffect, ParamValue } from "@sidecut/contracts/project";

export type FilmoraProperties = Record<string, NonNullable<Clip["video"]>[string]>;
export type FilmoraMappedEffect = Pick<ClipEffect, "id" | "type" | "enabled" | "params">;
const embedded = (value: unknown): unknown =>
  typeof value === "string" ? JSON.parse(value) : value;
type FilmoraEffect = {
  id: string;
  display: string;
  on: boolean;
  explicitlyEnabled: boolean;
  params: ObjectValue;
  keys: ObjectValue;
};
export function filmoraEffects(node: ObjectValue): FilmoraEffect[] {
  return list(node.effectChainList ?? []).flatMap((chain) =>
    list(object(chain).effectList ?? []).map((raw) => {
      const effect = object(raw);
      return {
        id: String(effect.id ?? ""),
        display: String(effect.display ?? effect.id ?? ""),
        on: effect.enable !== false,
        explicitlyEnabled: effect.enable === true,
        params: Object.fromEntries(
          list(effect.paramList ?? []).map((rawParam) => {
            const p = object(rawParam);
            return [text(p.name), object(p.fxParam).unValue];
          }),
        ),
        keys: Object.fromEntries(
          list(effect.paramMapList ?? []).map((rawMap) => {
            const p = object(rawMap);
            return [text(p.name), embedded(object(p.keyFrame).parameter)];
          }),
        ),
      };
    }),
  );
}
type Point = { time: number; value: number };
function points(value: unknown, sourceStart: number, speed: number): Point[] {
  if (value == null) return [];
  const raw = list(object(embedded(value)).keyframeSets ?? []).map((rawKey) => {
    const k = object(rawKey);
    return { time: number(k["_time"]), value: number(k["_value"]) };
  });
  const ticks = raw.some((p) => p.time > 100000);
  return raw
    .map((p) => ({
      time: ((ticks ? p.time / 10000000 : p.time) - sourceStart) / speed,
      value: p.value,
    }))
    .sort((a, b) => a.time - b.time);
}
function at(samples: Point[], time: number, fallback: number) {
  if (!samples.length) return fallback;
  if (time <= samples[0]!.time) return samples[0]!.value;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!,
      b = samples[i]!;
    if (time <= b.time)
      return b.time === a.time
        ? b.value
        : a.value + ((b.value - a.value) * (time - a.time)) / (b.time - a.time);
  }
  return samples.at(-1)!.value;
}
function frames(times: number[], duration: number, value: (time: number) => ParamValue) {
  let unique = [...new Set(times.map((t) => Math.round(t * 1000000) / 1000000))].sort(
    (a, b) => a - b,
  );
  const before = unique.findLast((t) => t < 0),
    after = unique.find((t) => t > duration);
  unique = unique.filter((t) => (before == null || t >= before) && (after == null || t <= after));
  const keys = unique.map((time) => ({ time, value: value(time), interpolation: "linear" }));
  return keys.length > 1 && new Set(keys.map((k) => JSON.stringify(k.value))).size > 1 ? keys : [];
}
function colour(
  effect: FilmoraEffect,
  make: (type: string, params: FilmoraProperties) => FilmoraMappedEffect,
  warnings: string[],
) {
  const adjust: FilmoraProperties = {},
    hsl: FilmoraProperties = {},
    vignette: FilmoraProperties = {},
    lut: FilmoraProperties = {};
  const basic: Record<string, string> = {
    u_contrast: "contrast",
    u_blackLevel: "blackLevel",
    u_highlight: "highlights",
    u_highlights: "highlights",
    u_shadow: "shadows",
    u_shadows: "shadows",
    u_saturation: "saturation",
    u_vibrance: "vibrance",
    u_temperature: "temperature",
    u_tint: "tint",
  };
  for (const [key, raw] of Object.entries(effect.params).sort(([a], [b]) => a.localeCompare(b))) {
    if (key.startsWith("bEnable") || /degree(Min|Max)Val$/.test(key) || key.startsWith("autoColor"))
      continue;
    if (key === "lut3dPath") {
      if (typeof raw === "string" && raw) lut.path = raw;
      continue;
    }
    if (typeof raw !== "number") continue;
    const value = number(raw);
    if (!value) continue;
    if (basic[key]) adjust[basic[key]!] = value;
    else if (["u_exposure", "u_brightness"].includes(key)) {
      adjust.exposure = Number(adjust.exposure ?? 0) + value / 50;
      warnings.push(`Colour setting ${key} was converted roughly.`);
    } else if (["amount", "size", "feather"].includes(key)) vignette[key] = value;
    else if (key === "alpha") lut.intensity = value > 1 ? value / 100 : value;
    else {
      const match =
        /^(Red|Orange|Yellow|Green|Aqua|Blue|Purple|Magenta)_(satVal|hueVal|brightnessVal|lumVal|lightVal|luminanceVal)$/.exec(
          key,
        );
      if (match)
        hsl[
          `${match[1]!.toLowerCase()}${match[2] === "satVal" ? "Saturation" : match[2] === "hueVal" ? "Hue" : "Luminance"}`
        ] = value;
      else warnings.push(`Colour setting ${key} has no Tandem equivalent.`);
    }
  }
  return [
    Object.keys(adjust).length ? make("colorAdjust", adjust) : null,
    Object.keys(hsl).length ? make("hsl", hsl) : null,
    vignette.amount != null ? make("vignette", vignette) : null,
    lut.path ? make("lut", lut) : null,
  ].filter((v) => v != null);
}

export function filmoraVideo(
  node: ObjectValue,
  options: { id: string; duration: number; sourceStart: number; speed: number; camera: boolean },
  warnings: string[],
) {
  const all = filmoraEffects(node);
  const transform = { position: { x: 0.5, y: 0.5 }, scale: 1, rotation: 0 };
  const video: FilmoraProperties = {};
  const keys: Record<string, Clip["keyframes"][string]> = {};
  const mapped: FilmoraMappedEffect[] = [],
    grades: FilmoraMappedEffect[] = [];
  const make = (type: string, params: FilmoraProperties): FilmoraMappedEffect => ({
    id: `fx_${options.id}_${type}_${mapped.length + grades.length}`,
    type,
    enabled: true,
    params,
  });
  const trans = all.find((e) => e.id === "video/effect/transform" && e.on);
  if (trans) {
    const p = trans.params;
    const sx = number(p.Scale_x, 100),
      sy = number(p.Scale_y, sx);
    if (Math.abs(sx - sy) > 0.5) warnings.push("A stretched clip keeps only its width scale.");
    transform.position = { x: number(p.Position_x, 0.5), y: number(p.Position_y, 0.5) };
    transform.scale = sx / 100;
    transform.rotation = number(p.Rotation, 0);
    const x = points(trans.keys.Position_x, options.sourceStart, options.speed),
      y = points(trans.keys.Position_y, options.sourceStart, options.speed);
    const position = frames(
      [...x, ...y].map((sample) => sample.time),
      options.duration,
      (t) => ({ x: at(x, t, transform.position.x), y: at(y, t, transform.position.y) }),
    );
    if (position.length) keys["video.transform.position"] = position;
    for (const [source, target, fallback, divisor] of [
      ["Scale_x", "video.transform.scale", 100, 100],
      ["Rotation", "video.transform.rotation", 0, 1],
    ] as const) {
      const samples = points(
        trans.keys[source] ?? (source === "Scale_x" ? trans.keys.Scale_y : undefined),
        options.sourceStart,
        options.speed,
      );
      const f = frames(
        samples.map((sample) => sample.time),
        options.duration,
        (t) => at(samples, t, fallback) / divisor,
      );
      if (f.length) keys[target] = f;
    }
    if (number(p.EnableShadow, 0))
      mapped.push(
        make("dropShadow", {
          distance: number(p.nDistance, 4),
          blur: number(p.nBlur, 5),
          opacity: number(p.nAlpha, 60),
          ...(p.uDirectAngle != null ? { angle: number(p.uDirectAngle) } : {}),
        }),
      );
    if (["LeftTop", "RightTop", "LeftBottom", "RightBottom"].some((k) => p[k] != null))
      warnings.push("Corner settings on the transform aren't imported.");
  }
  const crop = all.find((e) => e.id === "video/effect/crop-pan-zoom" && e.on);
  if (crop) {
    const p = crop.params;
    if ([p.crop_x, p.crop_y, p.crop_width, p.crop_height].every((v) => v != null)) {
      const x = number(p.crop_x),
        y = number(p.crop_y),
        w = number(p.crop_width),
        h = number(p.crop_height);
      if (w <= 0 || h <= 0) throw new Error("Invalid Filmora crop dimensions.");
      video.crop = {
        left: x,
        top: y,
        right: Math.max(0, 1 - x - w),
        bottom: Math.max(0, 1 - y - h),
      };
    }
    if (p.SettingScript != null) {
      const rects = list(embedded(p.SettingScript))
        .map((raw) => {
          const r = object(raw);
          return {
            time: number(r.Time, 0),
            x: number(r.X, 0),
            y: number(r.Y, 0),
            w: number(r.Width),
            h: number(r.Height),
          };
        })
        .filter((r) => r.w > 0 && r.h > 0)
        .sort((a, b) => a.time - b.time);
      if (rects.some((r) => r.x !== 0 || r.y !== 0 || r.w !== 1 || r.h !== 1)) {
        const zoom = (r: (typeof rects)[number]) => {
          const scale = transform.scale * Math.min(1 / r.w, 1 / r.h);
          return {
            scale,
            position: {
              x: transform.position.x - (r.x + r.w / 2 - 0.5) * scale,
              y: transform.position.y - (r.y + r.h / 2 - 0.5) * scale,
            },
          };
        };
        if (rects.length === 1) Object.assign(transform, zoom(rects[0]!));
        else {
          keys["video.transform.scale"] = rects.map((r) => ({
            time: r.time * options.duration,
            value: zoom(r).scale,
            interpolation: "linear",
          }));
          keys["video.transform.position"] = rects.map((r) => ({
            time: r.time * options.duration,
            value: zoom(r).position,
            interpolation: "linear",
          }));
        }
        warnings.push("Crop and zoom was approximated with transform animation.");
      }
    }
  }
  video.transform = transform;
  const pip = node.pipBuf == null ? {} : object(embedded(node.pipBuf));
  if (pip.Opacity != null && number(pip.Opacity) < 99.95)
    video.opacity = Math.max(0, number(pip.Opacity) / 100);
  const opacity = points(pip.OpacityKeyFrame, options.sourceStart, options.speed);
  const opacityKeys = frames(
    opacity.map((p) => p.time),
    options.duration,
    (t) => at(opacity, t, 100) / 100,
  );
  if (opacityKeys.length) keys["video.opacity"] = opacityKeys;
  if (pip.BlendMode != null && !["normal", "0", ""].includes(String(pip.BlendMode).toLowerCase()))
    warnings.push(`Blend mode ${String(pip.BlendMode)} isn't supported; the clip draws normally.`);
  if (
    (node.humanseg_hair != null && object(node.humanseg_hair).status === 1) ||
    all.some((e) => e.display === "Human Segmentation" && e.on)
  )
    video.cutout = { enabled: true };
  if (options.camera) {
    if (
      Math.abs(transform.scale - 1) < 0.01 &&
      Math.abs(transform.position.x - 0.5) < 0.01 &&
      Math.abs(transform.position.y - 0.5) < 0.01 &&
      !video.cutout
    )
      video.layoutPreset = "full";
    else if (Math.abs(transform.scale - 0.5) < 0.05 && transform.position.y > 0.5 && video.cutout)
      video.layoutPreset = transform.position.x > 0.5 ? "pipRight" : "pipLeft";
  }
  for (const effect of all) {
    if (!effect.on) continue;
    if (
      [
        "video/effect/transform",
        "video/effect/crop-pan-zoom",
        "B4CF1D0F-D10A-1613-6EF4-A4F0D0364978",
        "87289B96-239D-4740-BF86-023F54349902",
      ].includes(effect.id)
    )
      continue;
    if (effect.id === "662E16ED-4524-4D13-AAE9-11DBA0C63E17") {
      grades.push(...colour(effect, make, warnings));
      continue;
    }
    if (["video/effect/horizontal_filp", "video/effect/vertical_filp"].includes(effect.id)) {
      if (effect.explicitlyEnabled)
        warnings.push("Flipped clips aren't supported; the clip isn't flipped.");
      continue;
    }
    if (effect.display === "Sharpen") {
      const amount = number(effect.params.amount, 0);
      if (amount > 0) mapped.push(make("sharpen", { amount }));
    } else if (effect.display === "PipBorder") {
      const width = number(effect.params.Size, 0);
      const color = number(effect.params.Color, -1);
      if (width > 0)
        mapped.push(
          make("border", {
            width,
            ...(color >= 0
              ? {
                  color: {
                    r: ((color >> 16) & 255) / 255,
                    g: ((color >> 8) & 255) / 255,
                    b: (color & 255) / 255,
                    a: 1,
                  },
                }
              : {}),
          }),
        );
    } else if (
      [
        "ColorWheel",
        "rgbcurve",
        "CurveColor",
        "HDRColor",
        "InnerShadow",
        "HumanSegmentationHairEffect",
        "Human Segmentation",
      ].includes(effect.display)
    ) {
      if (
        effect.explicitlyEnabled &&
        effect.display !== "Human Segmentation" &&
        Object.values(effect.params).some((v) => typeof v === "number" && v !== 0)
      )
        warnings.push(`Effect ${effect.display} isn't supported.`);
    } else if (Object.keys(effect.params).length || effect.explicitlyEnabled)
      warnings.push(`Effect ${effect.display} isn't supported.`);
  }
  if (node.animation != null || node.inAnimation != null)
    warnings.push("Clip in/out animation isn't imported.");
  video.effects = mapped;
  return { video, keyframes: keys, colour: grades };
}

export function filmoraAudio(
  node: ObjectValue,
  duration: number,
  warnings: string[],
): FilmoraProperties {
  const all = filmoraEffects(node);
  const audio: FilmoraProperties = { gainDB: 0, fadeIn: 0, fadeOut: 0 };
  const volume = all.find((e) => e.id === "audio/effect/volume" && e.on);
  if (volume) {
    audio.gainDB = number(volume.params.VolumeGain, 0);
    if (volume.params.LoudnessGainEnable === true) {
      audio.normalizeTo = -24;
      audio.gainDB += number(volume.params.LoudnessGain, 0);
    }
    const balance = number(volume.params.Balance, 0);
    if (balance !== 0 && Math.abs(balance - 0.5) > 0.01)
      warnings.push("Pan (balance) isn't supported; the clip plays centred.");
  }
  const fade = all.find((e) => e.id === "audio/effect/fade" && e.on);
  if (fade) {
    const a = number(fade.params.FadeInTime, 0),
      b = number(fade.params.FadeOutTime, 0);
    if (a < 0 || b < 0) throw new Error("Invalid negative Filmora audio fade.");
    audio.fadeIn = Math.min(a, duration);
    audio.fadeOut = Math.min(b, duration);
    if (a > duration || b > duration)
      warnings.push("Fades longer than their clip were shortened to the clip.");
  }
  if (node.enableV3Denoise === true) {
    audio.voiceIsolation = Math.min(1, Math.max(0, number(node.denoiseV3Strength, 50) / 100));
    warnings.push("Filmora AI denoise became voice isolation.");
  }
  for (const effect of all.filter((e) => e.id.startsWith("audio/") && e.on)) {
    if (
      [
        "audio/effect/volume",
        "audio/effect/fade",
        "audio/effect/clip_volume",
        "audio/effect/change_channel",
      ].includes(effect.id)
    )
      continue;
    const active = Object.values(effect.params).some((v) =>
      typeof v === "number" ? v !== 0 : v === true,
    );
    if (
      [
        "audio/effect/audio_enhancer",
        "audio/effect/speech_enhance",
        "audio/effect/reverb_denoise",
      ].includes(effect.id) &&
      active
    ) {
      audio.voiceIsolation = 1;
      warnings.push("Filmora voice enhancer became voice isolation.");
    } else if (effect.id === "audio/effect/ducking" && effect.explicitlyEnabled)
      warnings.push("Auto ducking isn't supported.");
    else if (active && (effect.id !== "audio/effect/equalizer" || effect.explicitlyEnabled))
      warnings.push(`Audio effect ${effect.display} isn't supported.`);
  }
  if (node.volumeKeyframe != null) {
    const parameter = object(node.volumeKeyframe).parameter;
    if (parameter != null && list(object(embedded(parameter)).keyframeSets ?? []).length >= 2)
      warnings.push("Volume keyframes aren't imported; the clip keeps its overall level.");
  }
  return audio;
}
