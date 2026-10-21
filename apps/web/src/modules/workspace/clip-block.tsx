import { useEffect, useRef, useState } from "react";
import type { Clip, Track, Project } from "@sidecut/contracts/project";
import { useEditorSession } from "./editor-session";
import { atFrame } from "./timeline-model";
import { Time } from "@sidecut/contracts/time";
import { selectionWithLinks } from "./edit-actions";

interface Gesture {
  operation: "move" | "trim" | "ripple" | "roll" | "slip" | "slide";
  x: number;
  delta: number;
  edge: "start" | "end" | null;
  revision: number;
  pointer: number;
  ids: readonly string[];
  target: string | null;
}
export function snapEdit(
  seconds: number,
  project: Project,
  zoom: number,
  exclude: readonly string[],
  playhead: number,
) {
  const candidates = [
    0,
    playhead,
    ...[...project.videoTracks, ...project.audioTracks].flatMap((t) =>
      t.clips
        .filter((c) => !exclude.includes(c.id))
        .flatMap((c) => [c.start.seconds, c.start.seconds + c.duration.seconds]),
    ),
  ];
  const nearest = candidates.sort((a, b) => Math.abs(a - seconds) - Math.abs(b - seconds))[0];
  return nearest !== undefined && Math.abs(nearest - seconds) <= 6 / zoom
    ? atFrame(nearest, project)
    : atFrame(seconds, project);
}

export function ClipBlock({
  clip,
  track,
  zoom,
  selected,
  run,
}: {
  clip: Clip;
  track: Track;
  zoom: number;
  selected: readonly string[];
  run: (action: () => unknown) => void;
}) {
  const { session, snapshot, editor } = useEditorSession();
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const active = useRef<Gesture | null>(null);
  const capture = useRef<HTMLElement | null>(null);
  const suppressed = useRef(false);
  const selectedByPointer = useRef(false);
  const clear = () => {
    const value = active.current;
    active.current = null;
    setGesture(null);
    if (value && capture.current?.hasPointerCapture(value.pointer))
      capture.current.releasePointerCapture(value.pointer);
  };
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active.current) {
        event.preventDefault();
        suppressed.current = true;
        clear();
      }
    };
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("keydown", cancel);
      if (active.current && capture.current?.hasPointerCapture(active.current.pointer))
        capture.current.releasePointerCapture(active.current.pointer);
    };
  }, []);
  const disabled = snapshot.readOnly || snapshot.busy || track.locked;
  const choose = (additive = false) => {
    const ids = selectionWithLinks(snapshot.project, [clip.id]);
    const current = editor.getState().selected;
    const all = ids.every((id) => current.includes(id));
    editor.setState({
      selected: additive
        ? all
          ? current.filter((id) => !ids.includes(id))
          : [...new Set([...current, ...ids])]
        : ids,
    });
  };
  const begin = (event: React.PointerEvent<HTMLElement>, edge: Gesture["edge"]) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    selectedByPointer.current = !editor.getState().selected.includes(clip.id);
    if (selectedByPointer.current) choose(event.shiftKey || event.ctrlKey || event.metaKey);
    editor.getState().setPlaying(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    capture.current = event.currentTarget;
    const value: Gesture = {
      operation: edge
        ? event.altKey
          ? "roll"
          : event.shiftKey
            ? "ripple"
            : "trim"
        : event.altKey
          ? event.shiftKey
            ? "slide"
            : "slip"
          : "move",
      x: event.clientX,
      delta: 0,
      edge,
      revision: snapshot.revision,
      pointer: event.pointerId,
      ids: editor.getState().selected,
      target: null,
    };
    active.current = value;
    setGesture(value);
  };
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const value = active.current;
    if (!value) return;
    const original =
      value.edge === "end" ? clip.start.seconds + clip.duration.seconds : clip.start.seconds;
    const proposed = original + (event.clientX - value.x) / zoom;
    const snapped =
      value.operation === "ripple" && value.edge === "start" && proposed < 0
        ? Time.fromSeconds(proposed).roundedToFrame(snapshot.project.settings.frameRate)
        : snapEdit(proposed, snapshot.project, zoom, value.ids, editor.getState().playhead.seconds);
    const target =
      document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-track-id]")?.dataset.trackId ?? null;
    const delta =
      value.operation === "slip"
        ? Time.fromSeconds((event.clientX - value.x) / zoom).roundedToFrame(
            snapshot.project.settings.frameRate,
          ).seconds
        : snapped.seconds - original;
    const next = { ...value, delta, target };
    active.current = next;
    setGesture(next);
  };
  const finish = () => {
    const value = active.current;
    if (!value) return;
    const changed =
      Math.abs(value.delta) > 0.00001 ||
      (value.operation === "move" && value.target != null && value.target !== track.id);
    clear();
    if (!changed) return;
    suppressed.current = true;
    run(() => {
      if (value.operation === "slip" || value.operation === "slide")
        return session.apply({
          label: value.operation === "slip" ? "Slip clip" : "Slide clip",
          expectedRevision: value.revision,
          commands: [
            value.operation === "slip"
              ? { slip: { clipID: clip.id, delta: value.delta } }
              : { slide: { clipID: clip.id, delta: value.delta } },
          ],
        });
      if (value.operation === "roll") {
        const neighbor = track.clips.find(
          (c) =>
            c.id !== clip.id &&
            (value.edge === "start"
              ? c.start.flicks + c.duration.flicks === clip.start.flicks
              : c.start.flicks === clip.start.flicks + clip.duration.flicks),
        );
        if (!neighbor) throw new Error("Roll needs a neighboring clip touching this edge.");
        return session.apply({
          label: "Roll cut",
          expectedRevision: value.revision,
          commands: [
            {
              roll: {
                leftClipID: value.edge === "start" ? neighbor.id : clip.id,
                rightClipID: value.edge === "start" ? clip.id : neighbor.id,
                delta: value.delta,
              },
            },
          ],
        });
      }
      if (value.edge)
        return session.apply({
          label: value.operation === "ripple" ? "Ripple trim clip" : "Trim clip",
          expectedRevision: value.revision,
          commands: [
            {
              trim: {
                clipID: clip.id,
                edge: value.edge,
                ripple: value.operation === "ripple",
                to:
                  (value.edge === "start"
                    ? clip.start.seconds
                    : clip.start.seconds + clip.duration.seconds) + value.delta,
              },
            },
          ],
        });
      let ids = [...value.ids];
      const destination = value.target && value.target !== track.id ? value.target : null;
      if (destination) {
        const all = [...snapshot.project.videoTracks, ...snapshot.project.audioTracks];
        const primary = track.clips.filter((c) => ids.includes(c.id)),
          groups = new Set(primary.map((c) => c.linkGroup).filter(Boolean));
        const others = all
          .flatMap((t) => t.clips)
          .filter((c) => ids.includes(c.id) && !track.clips.some((p) => p.id === c.id));
        if (others.every((c) => c.linkGroup && groups.has(c.linkGroup)))
          ids = primary.map((c) => c.id);
      }
      return session.apply({
        label: "Move clips",
        expectedRevision: value.revision,
        commands: [
          {
            moveClips: {
              clipIDs: ids,
              delta: value.delta,
              ...(destination ? { toTrackID: destination } : {}),
            },
          },
        ],
      });
    });
  };
  const start =
      clip.start.seconds +
      (gesture?.operation === "slip" ||
      gesture?.edge === "end" ||
      (gesture?.operation === "ripple" && gesture.edge === "start")
        ? 0
        : (gesture?.delta ?? 0)),
    duration =
      clip.duration.seconds +
      (gesture?.edge === "end" ? gesture.delta : gesture?.edge === "start" ? -gesture.delta : 0);
  const pointer = {
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: () => {
      suppressed.current = true;
      clear();
    },
  };
  const nudgeTrim = (edge: "start" | "end", event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta =
      ((event.key === "ArrowLeft" ? -1 : 1) * snapshot.project.settings.frameRate.denominator) /
      snapshot.project.settings.frameRate.numerator;
    run(() =>
      session.apply({
        label: "Trim clip edge",
        commands: [
          {
            trim: {
              clipID: clip.id,
              edge,
              to:
                (edge === "start"
                  ? clip.start.seconds
                  : clip.start.seconds + clip.duration.seconds) + delta,
            },
          },
        ],
      }),
    );
  };
  return (
    <div
      className="editor-clip"
      data-clip-id={clip.id}
      data-selected={selected.includes(clip.id)}
      data-invalid={duration <= 0 || start < 0}
      style={{ left: start * zoom, width: Math.max(2, duration * zoom) }}
      title={`${clip.name ?? clip.id} · ${start.toFixed(3)} s · ${duration.toFixed(3)} s`}
    >
      <button
        className="editor-clip-body"
        aria-label={`Select clip ${clip.name ?? clip.id}`}
        title="Drag to move. Alt-drag to slip source; Alt+Shift-drag to slide between neighbors."
        aria-pressed={selected.includes(clip.id)}
        onPointerDown={(event) => begin(event, null)}
        {...pointer}
        onClick={(event) => {
          if (suppressed.current) {
            suppressed.current = false;
            selectedByPointer.current = false;
            return;
          }
          if (selectedByPointer.current) {
            selectedByPointer.current = false;
            return;
          }
          choose(event.shiftKey || event.ctrlKey || event.metaKey);
        }}
      >
        {clip.name ?? clip.id}
        {clip.linkGroup && <span aria-label="Linked clip"> ↔</span>}
      </button>
      {(["start", "end"] as const).map((edge) => (
        <button
          key={edge}
          className="editor-trim-handle"
          data-edge={edge}
          aria-label={`Trim ${edge} ${clip.name ?? clip.id}`}
          title="Drag to trim. Shift-drag to ripple trim; Alt-drag to roll a touching cut."
          disabled={disabled}
          onPointerDown={(event) => begin(event, edge)}
          {...pointer}
          onKeyDown={(event) => nudgeTrim(edge, event)}
          onClick={(event) => event.stopPropagation()}
        />
      ))}
    </div>
  );
}
