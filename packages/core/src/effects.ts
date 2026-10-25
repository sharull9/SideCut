// Metadata ported from TandemCore/EffectRegistry.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { ClipEffect, ParamValue } from "@sidecut/contracts/project";
import definitions from "./effect-registry.json";
import { transitionTypes } from "@sidecut/contracts/project";
import { fixedParameters } from "./keyframes";
import { QueryError } from "./project-queries";
export interface ParamDefinition {
  key: string;
  name: string;
  kind: string;
  defaultValue: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  animatable: boolean;
}
export interface EffectDefinition {
  type: string;
  name: string;
  category: string;
  domain: string;
  summary: string;
  params: readonly ParamDefinition[];
}
export const effectRegistry = definitions as readonly EffectDefinition[];
export const styleEffects = new Set(["roundedCorners", "border", "dropShadow"]);
export const renderedEffects = new Set([
  "pitchShift",
  "compressor",
  "limiter",
  "voiceCleanup",
  "sharpen",
  "blur",
  "pixelate",
  ...styleEffects,
  "colorAdjust",
  "hsl",
  "colorWheels",
  "lut",
  "vignette",
]);
export const effectDefinition = (type: string) => effectRegistry.find((d) => d.type === type);
export function effectsCatalog(wanted?: string) {
  const effects = effectRegistry
    .filter((e) => wanted == null || e.type.toLowerCase() === wanted.toLowerCase())
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  if (!effects.length) throw new QueryError("notFound", "Unknown effect type.");
  const durations = {
    dissolve: 0.5,
    fadeToBlack: 1.1,
    fadeFromBlack: 1.1,
    push: 0.7,
    slide: 0.7,
    cutSlide: 0.57,
    wipe: 0.6,
    zoom: 0.5,
  };
  return {
    effects: effects.map((e) => ({ ...e, rendered: renderedEffects.has(e.type) })),
    transitions: transitionTypes.map((type) => ({ type, defaultDuration: durations[type] })),
    layouts: Object.entries({
      full: "Full",
      pipRight: "PiP right",
      pipLeft: "PiP left",
      split: "Split",
      fill: "Fill",
    }).map(([preset, name]) => ({ preset, name })),
    animatable: [
      ...fixedParameters,
      "video.effects.<effectID>.<param>",
      "audio.effects.<effectID>.<param>",
    ],
    warnings: ["Effects without a renderer are retained but cannot be rendered."],
  };
}
export function resolvedParams(effect: ClipEffect): Record<string, unknown> {
  const params = {
    ...Object.fromEntries(
      effectDefinition(effect.type)?.params.map((p) => [p.key, p.defaultValue]) ?? [],
    ),
    ...effect.params,
  };
  for (const definition of effectDefinition(effect.type)?.params ?? []) {
    if (typeof params[definition.key] !== typeof definition.defaultValue)
      params[definition.key] = definition.defaultValue;
  }
  return params;
}
