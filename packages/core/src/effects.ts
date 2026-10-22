// Metadata ported from TandemCore/EffectRegistry.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import type { ClipEffect, ParamValue } from "@sidecut/contracts/project";
import definitions from "./effect-registry.json";
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
