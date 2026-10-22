// Behavior ported from TandemCore/Editing.swift. Notice: tests/fixtures/tandem/TANDEM-LICENSE.
import { Schema } from "effect";
import { EffectSchema } from "@sidecut/contracts/project";
import type { Project, Clip, ClipEffect } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import type { EditContext } from "./timeline-editing";
import { requireClip, unlocked, replace } from "./timeline-editing";
import { mergePatch } from "./json-merge-patch";
import { effectDefinition } from "./effects";
export const effectsOf = (clip: Clip, kind: "video" | "audio"): readonly ClipEffect[] =>
  (clip[kind]?.effects ?? []) as readonly ClipEffect[];
export function editEffects(
  project: Project,
  command: EditCommand,
  context: EditContext,
): Project | null {
  if (
    !(
      "addEffect" in command ||
      "updateEffect" in command ||
      "removeEffect" in command ||
      "moveEffect" in command
    )
  )
    return null;
  const body =
    "addEffect" in command
      ? command.addEffect
      : "updateEffect" in command
        ? command.updateEffect
        : "removeEffect" in command
          ? command.removeEffect
          : command.moveEffect;
  const { track, clip } = requireClip(project, body.clipID);
  unlocked(track);
  let kind: "video" | "audio" = track.kind;
  let effect: ClipEffect | undefined;
  if ("addEffect" in command) {
    const input = command.addEffect.effect;
    const definition = effectDefinition(input.type);
    if (!definition)
      context.warn(`Unknown effect type "${input.type}". It's kept, but nothing renders it yet.`);
    kind = (definition?.domain ?? track.kind) as "video" | "audio";
    if (kind !== track.kind)
      throw new Error(
        `${input.type} is a ${kind} effect but this clip is on a ${track.kind} track.`,
      );
    effect = Schema.decodeUnknownSync(EffectSchema)({
      ...input,
      id: input.id ?? context.makeID("fx"),
      enabled: input.enabled ?? true,
      params: input.params ?? {},
    });
  } else {
    const id = "effectID" in body ? body.effectID : "";
    kind = effectsOf(clip, "video").some((fx) => fx.id === id) ? "video" : "audio";
    effect = effectsOf(clip, kind).find((fx) => fx.id === id);
    if (!effect) throw new Error(`Effect ${id} not found on clip ${clip.id}.`);
  }
  const list = [...effectsOf(clip, kind)],
    frames = { ...clip.keyframes };
  const index = list.findIndex((fx) => fx.id === effect.id);
  if ("addEffect" in command) {
    if (index >= 0) throw new Error(`Clip ${clip.id} already has effect ${effect.id}.`);
    list.splice(
      Math.min(Math.max(command.addEffect.index ?? list.length, 0), list.length),
      0,
      effect,
    );
    context.createdIDs.push(effect.id);
  } else if ("updateEffect" in command) {
    if ("id" in command.updateEffect.patch) throw new Error("Effect patch cannot change id.");
    list[index] = Schema.decodeUnknownSync(EffectSchema)(
      mergePatch(
        Schema.encodeSync(EffectSchema)(effect) as typeof Schema.Json.Type,
        command.updateEffect.patch,
      ),
    );
  } else if ("removeEffect" in command) {
    list.splice(index, 1);
    for (const path of Object.keys(frames))
      if (
        [`video.effects.${effect.id}.`, `audio.effects.${effect.id}.`].some((prefix) =>
          path.startsWith(prefix),
        )
      )
        delete frames[path];
  } else {
    list.splice(index, 1);
    list.splice(Math.min(Math.max(command.moveEffect.index, 0), list.length), 0, effect);
  }
  return replace(project, {
    ...track,
    clips: track.clips.map((c) =>
      c.id === clip.id
        ? { ...clip, [kind]: { ...clip[kind], effects: list }, keyframes: frames }
        : c,
    ),
  });
}
