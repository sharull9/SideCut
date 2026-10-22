import { useEffect, useState } from "react";
import type { Clip } from "@sidecut/contracts/project";
import { effectDefinition, resolvedParams } from "@sidecut/core/effects";
import type { ClipEffect } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import { fixedParameters, resolveClip } from "@sidecut/core/keyframes";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@sidecut/ui/components/field";
import { useEditorSession, useEditorView } from "./editor-session";

export function KeyframeControls({ clips }: { clips: readonly Clip[] }) {
  const { session, snapshot, editor } = useEditorSession();
  const playhead = useEditorView((s) => s.playhead);
  const [clipID, setClipID] = useState(clips[0]!.id);
  const clip = clips.find((c) => c.id === clipID) ?? clips[0]!;
  const [parameter, setParameter] = useState("video.transform.scale"),
    [value, setValue] = useState("1"),
    [interpolation, setInterpolation] = useState("easeInOut"),
    [error, setError] = useState<string | null>(null);
  const track = [...snapshot.project.videoTracks, ...snapshot.project.audioTracks].find((t) =>
    t.clips.some((c) => c.id === clip.id),
  );
  const disabled = snapshot.readOnly || snapshot.busy || Boolean(track?.locked);
  const relativeTime = Time.fromSeconds(playhead.subtract(clip.start).seconds);
  const time = relativeTime.seconds;
  const list = clip.keyframes[parameter] ?? [];
  const sameTime = (n: unknown) => Time.fromSeconds(Number(n)).flicks === relativeTime.flicks;
  const exact = list.find((k) => sameTime(k.time));
  const inClip = time >= 0 && time <= clip.duration.seconds;
  const paths = new Set([...fixedParameters, ...Object.keys(clip.keyframes)]);
  for (const kind of ["video", "audio"] as const) {
    const effects = clip[kind]?.effects;
    if (Array.isArray(effects))
      for (const fx of effects) {
        if (
          !fx ||
          typeof fx !== "object" ||
          !("id" in fx) ||
          !("params" in fx) ||
          !fx.params ||
          typeof fx.params !== "object"
        )
          continue;
        for (const name of new Set([
          ...Object.keys(fx.params),
          ...(effectDefinition(String(fx.type))
            ?.params.filter((p) => p.animatable)
            .map((p) => p.key) ?? []),
        ]))
          paths.add(`${kind}.effects.${String(fx.id)}.${name}`);
      }
  }
  useEffect(() => {
    const resolved = resolveClip(clip, playhead.seconds);
    const parts = parameter.split(".");
    let current: unknown = resolved[parts[0] as "video" | "audio"];
    if (parts[1] === "effects") {
      const effects = resolved[parts[0] as "video" | "audio"]?.effects;
      const fx = Array.isArray(effects)
        ? effects.find((f) => f && typeof f === "object" && "id" in f && f.id === parts[2])
        : null;
      current =
        fx && typeof fx === "object" && "params" in fx && fx.params && typeof fx.params === "object"
          ? resolvedParams(fx as ClipEffect)[parts.slice(3).join(".")]
          : 0;
    } else
      for (const part of parts.slice(1))
        current =
          current && typeof current === "object"
            ? (current as Record<string, unknown>)[part]
            : undefined;
    const defaults =
      parameter === "video.transform.position"
        ? { x: 0.5, y: 0.5 }
        : ["video.transform.scale", "video.opacity"].includes(parameter)
          ? 1
          : 0;
    setValue(JSON.stringify(current ?? defaults));
    const currentKey = clip.keyframes[parameter]?.find(
      (k) =>
        Time.fromSeconds(Number(k.time)).flicks ===
        Time.fromSeconds(playhead.subtract(clip.start).seconds).flicks,
    );
    setInterpolation(
      typeof currentKey?.interpolation === "string" ? currentKey.interpolation : "easeInOut",
    );
  }, [clip, parameter, playhead]);
  const write = (frames: unknown[]) => {
    setError(null);
    try {
      editor.getState().setPlaying(false);
      session.apply({
        label: "Edit keyframes",
        expectedRevision: snapshot.revision,
        commands: [{ setKeyframes: { clipID: clip.id, parameter, keyframes: frames } }],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const navigate = (forward: boolean) => {
    const keys = [...list]
      .filter((k) => Number(k.time) >= 0 && Number(k.time) <= clip.duration.seconds)
      .sort((a, b) => Number(a.time) - Number(b.time));
    const next = forward
      ? keys.find((k) => Number(k.time) > time)
      : keys.filter((k) => Number(k.time) < time).at(-1);
    if (next) {
      editor.getState().setPlaying(false);
      editor.getState().seek(clip.start.add(Time.fromSeconds(Number(next.time))));
    }
  };
  return (
    <div className="editor-trim-form">
      <h3>Keyframes</h3>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="keyframe-clip">Keyframe clip</FieldLabel>
          <select id="keyframe-clip" value={clip.id} onChange={(e) => setClipID(e.target.value)}>
            {clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? c.id}
              </option>
            ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="keyframe-parameter">Parameter</FieldLabel>
          <select
            id="keyframe-parameter"
            value={parameter}
            onChange={(e) => setParameter(e.target.value)}
          >
            {[...paths].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="keyframe-value">Value (JSON)</FieldLabel>
          <Input
            id="keyframe-value"
            disabled={disabled}
            value={value}
            aria-invalid={Boolean(error)}
            onChange={(e) => setValue(e.target.value)}
          />
          <FieldDescription>
            Use a number, boolean, quoted string, point with x/y, or color with r/g/b/a. Supported
            picture effects render animated values. Sound and other effect renderers are planned.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="keyframe-easing">Interpolation to next key</FieldLabel>
          <select
            id="keyframe-easing"
            value={interpolation}
            disabled={disabled}
            onChange={(e) => setInterpolation(e.target.value)}
          >
            {["linear", "easeIn", "easeOut", "easeInOut", "hold"].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <p>
          {list.length} keys. Playhead {time.toFixed(3)} s from clip start.
          {!inClip && " Seek inside this clip to add a key."}
        </p>
        <div className="editor-clip-edit-actions">
          <Button
            size="xs"
            variant="outline"
            disabled={disabled || !inClip}
            onClick={() => {
              try {
                const parsed: unknown = JSON.parse(value);
                write([
                  ...list.filter((k) => !sameTime(k.time)),
                  { time, value: parsed, interpolation },
                ]);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            {exact ? "Update key at playhead" : "Add key at playhead"}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled || !exact}
            onClick={() => write(list.filter((k) => !sameTime(k.time)))}
          >
            Remove key at playhead
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!list.some((k) => Number(k.time) >= 0 && Number(k.time) < time)}
            onClick={() => navigate(false)}
          >
            Previous key
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={
              !list.some((k) => Number(k.time) > time && Number(k.time) <= clip.duration.seconds)
            }
            onClick={() => navigate(true)}
          >
            Next key
          </Button>
        </div>
        {error && <FieldError role="alert">{error}</FieldError>}
      </FieldGroup>
    </div>
  );
}
