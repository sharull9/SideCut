import { useEffect, useRef, useState } from "react";
import type { Clip } from "@sidecut/contracts/project";
import type { MeasuredSound } from "@sidecut/core/loudness";
import { speechMediaID } from "@sidecut/core/audio-editing";
import { LocalMediaReader } from "@sidecut/platform-browser/preview";
import { measureSource } from "@sidecut/platform-browser/audio-analysis";
import { Button } from "@sidecut/ui/components/button";
import { FieldError } from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";
import { CommitInput } from "./commit-input";
import { ActionRow, Hint, InspectorSection, PropertyRow } from "./inspector-layout";
import { voiceIsolationAvailable } from "@sidecut/platform-browser/voice-isolation";

export function AudioControls({ clip }: { clip: Clip }) {
  const { snapshot, session, editor } = useEditorSession();
  const track = snapshot.project.audioTracks.find((t) => t.clips.some((c) => c.id === clip.id));
  const [error, setError] = useState<string | null>(null),
    [measured, setMeasured] = useState<MeasuredSound | null>(null),
    [working, setWorking] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  if (!track) return null;
  const disabled = snapshot.readOnly || snapshot.busy || track.locked || working;
  const apply = (label: string, command: unknown, revision = snapshot.revision) => {
    setError(null);
    try {
      editor.getState().setPlaying(false);
      session.apply({ label, expectedRevision: revision, commands: [command] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const patch = (audio: Record<string, unknown>) =>
    apply("Update audio", { updateClip: { clipID: clip.id, patch: { audio } } });
  const analyze = async (normalize: boolean) => {
    const work = new AbortController(),
      project = snapshot.project,
      revision = snapshot.revision;
    controller.current = work;
    setWorking(true);
    setError(null);
    try {
      const reference = clip.content.media;
      const selected =
        reference && typeof reference === "object" && "mediaID" in reference
          ? String(reference.mediaID)
          : null;
      const ids = normalize
        ? [
            ...new Set(
              project.audioTracks.flatMap((t) =>
                t.locked
                  ? []
                  : t.clips.map((c) => speechMediaID(project, t, c)).filter((id) => id != null),
              ),
            ),
          ]
        : selected
          ? [selected]
          : [];
      const results: Record<string, { integratedLUFS: number; truePeakDBTP: number }> = {};
      for (const id of ids) {
        const local = await session.resource(id),
          media = project.media.find((m) => m.id === id);
        work.signal.throwIfAborted();
        if (!local || local.state !== "available" || !media)
          throw new Error(`Source ${media?.path ?? id} is missing or unsupported.`);
        const reader = await LocalMediaReader.open(local.file, media.kind);
        try {
          const result = await session.jobs.run(
            `analysis:${id}`,
            "Measure source sound",
            20,
            work.signal,
            (signal, progress) =>
              measureSource(local.file, reader, signal, progress, media.duration?.seconds),
          );
          work.signal.throwIfAborted();
          if (id === selected) setMeasured(result);
          // Silent measurements need no protective effects and cannot be encoded as JSON infinities.
          if (Number.isFinite(result.integratedLUFS) && Number.isFinite(result.truePeakDBTP))
            results[id] = {
              integratedLUFS: result.integratedLUFS,
              truePeakDBTP: result.truePeakDBTP,
            };
        } finally {
          reader.close();
        }
      }
      work.signal.throwIfAborted();
      if (normalize)
        apply("Normalize speech", { normalizeSpeech: { measured: results } }, revision);
    } catch (cause) {
      if (!work.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === work) {
        controller.current = null;
        setWorking(false);
      }
    }
  };
  const level = (value: number) => (Number.isFinite(value) ? value.toFixed(1) : "Silence");
  return (
    <>
      <InspectorSection id="audio.levels" title="Levels" label="Audio levels">
        <PropertyRow label="Playback" htmlFor="audio-muted">
          <select
            id="audio-muted"
            value={clip.audio?.muted ? "muted" : "audible"}
            disabled={disabled}
            onChange={(e) => patch({ muted: e.target.value === "muted" })}
          >
            <option value="audible">Audible</option>
            <option value="muted">Muted</option>
          </select>
        </PropertyRow>
        {(
          [
            ["gainDB", "Clip gain", "dB", -100, 30],
            ["fadeIn", "Fade in", "s", 0, clip.duration.seconds],
            ["fadeOut", "Fade out", "s", 0, clip.duration.seconds],
            ["voiceIsolation", "Voice isolation", "", 0, 1],
          ] as const
        ).map(([key, label, unit, min, max]) => (
          <PropertyRow key={key} label={label} htmlFor={`audio-${key}`}>
            <CommitInput
              id={`audio-${key}`}
              value={Number(clip.audio?.[key] ?? 0)}
              unit={unit}
              min={min}
              max={max}
              disabled={disabled}
              onCommit={(value) => patch({ [key]: value })}
            />
          </PropertyRow>
        ))}
        <Hint>
          Gain animation replaces clip gain. Fades use an equal-power curve. Add pitch and dynamics
          under Effects.
        </Hint>
        <Hint>
          {voiceIsolationAvailable()
            ? "Voice isolation blends the original at 0 with local RNNoise suppression at 1. Music and other voices may remain."
            : "Voice isolation is unavailable here. Use 0 to keep original sound."}
        </Hint>
      </InspectorSection>
      <InspectorSection id="audio.loudness" title="Loudness">
        <PropertyRow label="Speech levelling" htmlFor="audio-normalization">
          <select
            id="audio-normalization"
            value={typeof clip.audio?.normalizeTo === "number" ? "on" : "off"}
            disabled={disabled}
            onChange={(e) =>
              patch({
                normalizeTo:
                  e.target.value === "on" ? snapshot.project.settings.speechLoudness : null,
              })
            }
          >
            <option value="off">Off</option>
            <option value="on">Level source</option>
          </select>
        </PropertyRow>
        {typeof clip.audio?.normalizeTo === "number" && (
          <PropertyRow label="Source target" htmlFor="audio-target">
            <CommitInput
              id="audio-target"
              value={clip.audio.normalizeTo}
              unit="LUFS"
              min={-40}
              max={-10}
              disabled={disabled}
              onCommit={(value) => patch({ normalizeTo: value })}
            />
          </PropertyRow>
        )}
        <ActionRow>
          <Button
            size="xs"
            variant="outline"
            disabled={working}
            onClick={() => void analyze(false)}
          >
            Measure source
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => void analyze(true)}
          >
            Normalize all speech
          </Button>
          {working && (
            <Button size="xs" variant="ghost" onClick={() => controller.current?.abort()}>
              Cancel analysis
            </Button>
          )}
        </ActionRow>
        <Hint>
          Normalizes voice and camera sources across the project. Locked tracks stay unchanged. New
          protective effects are added only when measured peaks need them.
        </Hint>
        <div className="editor-readout" role="status" aria-live="polite">
          {working
            ? "Measuring local audio…"
            : measured
              ? `Source ${level(measured.integratedLUFS)} LUFS · ${level(measured.truePeakDBTP)} dBTP · range ${measured.loudnessRange.toFixed(1)} LU`
              : "Source has not been measured in this view."}
        </div>
        {error && <FieldError>{error}</FieldError>}
      </InspectorSection>
    </>
  );
}
