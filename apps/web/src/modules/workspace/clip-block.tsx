import { useCallback, useEffect, useRef, useState } from "react";
import type { Clip, Track } from "@sidecut/contracts/project";
import { useEditorSession } from "./editor-session";
import { atFrame, snapEdit } from "./timeline-model";
import { Time } from "@sidecut/contracts/time";
import { selectionWithLinks, type EditActions } from "./edit-actions";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@sidecut/ui/components/context-menu";
import { SourceSamples } from "./source-samples";
import { useDragAutoScroll } from "./drag-autoscroll";

interface Gesture {
  operation: "move" | "trim" | "ripple" | "roll" | "slip" | "slide";
  x: number;
  delta: number;
  edge: "start" | "end" | null;
  revision: number;
  pointer: number;
  ids: readonly string[];
  target: string | null;
  scrollStart: number;
}
// Colour family for a clip: picture, sound, text, graphic, or adjustment.
function clipKind(clip: Clip, track: Track) {
  if (track.kind === "audio") return "audio";
  const content = clip.content as Record<string, unknown>;
  if ("text" in content) return "text";
  if ("adjustment" in content) return "adjustment";
  if ("graphic" in content || "solid" in content) return "graphic";
  return "video";
}

export function ClipBlock({
  clip,
  track,
  zoom,
  selected,
  run,
  actions,
}: {
  clip: Clip;
  track: Track;
  zoom: number;
  selected: readonly string[];
  run: (action: () => unknown) => void;
  actions: EditActions;
}) {
  const { session, snapshot, editor } = useEditorSession();
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const { track: trackAutoScroll, stop: stopAutoScroll } = useDragAutoScroll();
  const active = useRef<Gesture | null>(null);
  const capture = useRef<HTMLElement | null>(null);
  const suppressed = useRef(false);
  const selectedByPointer = useRef(false);
  const clear = useCallback(() => {
    stopAutoScroll();
    const value = active.current;
    active.current = null;
    setGesture(null);
    if (value && capture.current?.hasPointerCapture(value.pointer))
      capture.current.releasePointerCapture(value.pointer);
  }, [stopAutoScroll]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active.current) {
        event.preventDefault();
        suppressed.current = true;
        clear();
      }
    };
    const blur = () => {
      if (active.current) {
        suppressed.current = true;
        clear();
      }
    };
    window.addEventListener("keydown", cancel, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", cancel, true);
      window.removeEventListener("blur", blur);
      if (active.current && capture.current?.hasPointerCapture(active.current.pointer))
        capture.current.releasePointerCapture(active.current.pointer);
    };
  }, [clear]);
  const disabled = snapshot.readOnly || snapshot.busy || track.locked;
  const choose = (additive = false) => {
    const ids = editor.getState().linkedSelection
      ? selectionWithLinks(snapshot.project, [clip.id])
      : [clip.id];
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
    const view = editor.getState();
    if (!edge && view.tool === "blade") {
      run(() =>
        session.apply({
          label: "Blade clip",
          commands: [
            {
              blade: {
                clipIDs: [clip.id],
                includeLinked: view.linkedSelection,
                at:
                  clip.start.seconds +
                  (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom,
              },
            },
          ],
        }),
      );
      return;
    }
    selectedByPointer.current = !editor.getState().selected.includes(clip.id);
    if (selectedByPointer.current) choose(event.shiftKey || event.ctrlKey || event.metaKey);
    editor.getState().setPlaying(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    capture.current = event.currentTarget;
    const value: Gesture = {
      operation: edge
        ? view.tool === "ripple" || view.rippleTrims
          ? "ripple"
          : view.tool === "roll"
            ? "roll"
            : event.altKey
              ? "roll"
              : event.shiftKey
                ? "ripple"
                : "trim"
        : view.tool === "slip"
          ? "slip"
          : view.tool === "slide"
            ? "slide"
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
      scrollStart: event.currentTarget.closest(".editor-timeline-scroll")?.scrollLeft ?? 0,
    };
    active.current = value;
    setGesture(value);
  };
  const updateDrag = (
    point: {
      clientX: number;
      clientY: number;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    },
    scroller: HTMLElement | null,
  ) => {
    const event = point;
    const value = active.current;
    if (!value) return;
    const original =
      value.edge === "end" ? clip.start.seconds + clip.duration.seconds : clip.start.seconds;
    const proposed =
      original + (event.clientX - value.x + (scroller?.scrollLeft ?? 0) - value.scrollStart) / zoom;
    const snapped =
      value.operation === "ripple" && value.edge === "start" && proposed < 0
        ? Time.fromSeconds(proposed).roundedToFrame(snapshot.project.settings.frameRate)
        : !editor.getState().snapping ||
            event.ctrlKey ||
            event.metaKey ||
            (event.shiftKey && value.operation === "move")
          ? atFrame(Math.max(0, proposed), snapshot.project)
          : snapEdit(
              proposed,
              snapshot.project,
              zoom,
              value.ids,
              editor.getState().playhead.seconds,
              value.operation === "move" ? clip.duration.seconds : 0,
            );
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
  const move = (event: React.PointerEvent<HTMLElement>) => {
    if (!active.current) return;
    const point = {
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
    const scroller = event.currentTarget.closest<HTMLElement>(".editor-timeline-scroll");
    updateDrag(point, scroller);
    trackAutoScroll(scroller, point.clientX, () => updateDrag(point, scroller));
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
              ? { slip: { clipID: clip.id, delta: -value.delta * clip.speed } }
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
    onLostPointerCapture: () => {
      if (active.current) {
        suppressed.current = true;
        clear();
      }
    },
  };
  const nudgeTrim = (edge: "start" | "end", event: React.KeyboardEvent) => {
    if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta =
      ((event.key === "ArrowLeft" ? -1 : 1) *
        (event.shiftKey ? 5 : 1) *
        snapshot.project.settings.frameRate.denominator) /
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
    <ContextMenu
      onOpenChange={(open) => {
        if (open && !editor.getState().selected.includes(clip.id)) choose();
      }}
    >
      <ContextMenuTrigger
        className="editor-clip"
        data-clip-id={clip.id}
        data-kind={clipKind(clip, track)}
        data-selected={selected.includes(clip.id)}
        data-invalid={duration <= 0 || start < 0}
        style={{ left: start * zoom, width: Math.max(2, duration * zoom) }}
        title={`${clip.name ?? clip.id} · ${start.toFixed(3)} s · ${duration.toFixed(3)} s`}
      >
        {clip.content.media !== null &&
          typeof clip.content.media === "object" &&
          "mediaID" in clip.content.media &&
          typeof clip.content.media.mediaID === "string" && (
            <SourceSamples
              mediaID={clip.content.media.mediaID}
              clip={clip}
              audio={track.kind === "audio"}
            />
          )}
        <button
          className="editor-clip-body"
          aria-label={`Select clip ${clip.name ?? clip.id}`}
          title="Drag to move. Alt-drag to slip source; Alt+Shift-drag to slide between neighbors."
          aria-pressed={selected.includes(clip.id)}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && !event.nativeEvent.isComposing) {
              event.preventDefault();
              suppressed.current = false;
              selectedByPointer.current = false;
              choose(event.shiftKey || event.ctrlKey || event.metaKey);
            }
          }}
          onPointerDown={(event) => begin(event, null)}
          {...pointer}
          onClick={(event) => {
            if (event.detail === 0) {
              suppressed.current = false;
              selectedByPointer.current = false;
              choose(event.shiftKey || event.ctrlKey || event.metaKey);
              return;
            }
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
          <span className="editor-clip-label">{clip.name ?? clip.id}</span>
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
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label={`Actions for ${clip.name ?? clip.id}`}
        finalFocus={() =>
          document.querySelector<HTMLElement>(
            `[data-clip-id="${CSS.escape(clip.id)}"] .editor-clip-body`,
          )
        }
      >
        <ContextMenuGroup>
          <ContextMenuItem onClick={actions.copy}>Copy clips</ContextMenuItem>
          <ContextMenuItem disabled={disabled || !actions.hasClipboard} onClick={actions.paste}>
            Paste at playhead
          </ContextMenuItem>
          <ContextMenuItem disabled={disabled} onClick={actions.split}>
            Split at playhead
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem disabled={disabled || selected.length < 2} onClick={actions.link}>
            Link selection
          </ContextMenuItem>
          <ContextMenuItem disabled={disabled || !clip.linkGroup} onClick={actions.unlink}>
            Unlink selection
          </ContextMenuItem>
          <ContextMenuItem disabled={disabled} onClick={() => actions.remove(false)}>
            Lift selection
          </ContextMenuItem>
          <ContextMenuItem disabled={disabled} onClick={() => actions.remove(true)}>
            Ripple delete selection
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
