import { RiArrowLeftRightLine } from "@remixicon/react";
import { Fragment, useState, useRef, type ReactNode } from "react";
import { transitionTypes } from "@sidecut/contracts/project";
import type { Clip, Track } from "@sidecut/contracts/project";
import { transitionWindow } from "@sidecut/core/transitions";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@sidecut/ui/components/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sidecut/ui/components/dialog";
import { useEditorSession } from "./editor-session";
import { defaultTransitionSound, TransitionSoundControls } from "./transition-sound-controls";
import { ActionRow, Hint, InspectorSection, PropertyRow } from "./inspector-layout";
import "./dialogs.css";

// The dialog keeps stacked fields; the inspector uses compact property rows.
function DialogRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
    </Field>
  );
}

type TransitionValue = Track["transitions"][number];
const TRANSITION_HELP =
  "Two-clip transitions center on the cut. Head and tail transitions stay inside the clip. Missing picture handles hold the source edge. Audio crossfades use equal power and keep unavailable source handles silent.";
function TransitionForm({
  track,
  transition,
  clip,
  compact,
}: {
  track: Track;
  transition?: TransitionValue;
  clip?: Clip;
  compact?: boolean;
}) {
  const Row = compact ? PropertyRow : DialogRow;
  const Group = compact ? Fragment : FieldGroup;
  const Actions = compact ? ActionRow : Fragment;
  const { session, snapshot } = useEditorSession();
  const [type, setType] = useState(String(transition?.type ?? "dissolve")),
    [direction, setDirection] = useState(String(transition?.direction ?? "left")),
    [duration, setDuration] = useState(
      String(transition?.duration ?? Math.min(1, clip?.duration.seconds ?? 1)),
    ),
    [side, setSide] = useState("tail"),
    [error, setError] = useState<string | null>(null);
  const disabled = snapshot.readOnly || snapshot.busy || track.locked;
  const run = (command: unknown) => {
    setError(null);
    try {
      session.apply({
        label: transition ? "Edit transition" : "Add transition",
        expectedRevision: session.getSnapshot().revision,
        commands: [command],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const id = String(transition?.id ?? clip?.id);
  return (
    <form
      className={compact ? "editor-section-form" : "editor-trim-form"}
      onSubmit={(event) => {
        event.preventDefault();
        const fields = { type, direction, duration: Number(duration) };
        const sound = defaultTransitionSound(snapshot.project, type);
        if (transition)
          run({
            updateTransition: {
              transitionID: transition.id,
              patch: {
                ...fields,
                ...(transition.type !== type && sound !== undefined ? { sound } : {}),
              },
            },
          });
        else {
          const next = track.clips.find(
            (c) => clip && c.start.flicks === clip.start.flicks + clip.duration.flicks,
          );
          run({
            addTransition: {
              trackID: track.id,
              ...(sound == null ? {} : { sound }),
              transition: {
                ...fields,
                fromClipID: side === "head" ? null : clip?.id,
                toClipID: side === "head" ? clip?.id : side === "next" ? (next?.id ?? "") : null,
              },
            },
          });
        }
      }}
    >
      <Group>
        {!transition && (
          <Row label="Clip edge" htmlFor={`transition-side-${id}`}>
            <select
              id={`transition-side-${id}`}
              disabled={disabled}
              value={side}
              onChange={(e) => setSide(e.target.value)}
            >
              <option value="head">Head</option>
              <option value="tail">Tail</option>
              <option value="next">Cut to next clip</option>
            </select>
          </Row>
        )}
        <Row label="Transition type" htmlFor={`transition-type-${id}`}>
          <select
            id={`transition-type-${id}`}
            disabled={disabled}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {transitionTypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Direction" htmlFor={`transition-direction-${id}`}>
          <select
            id={`transition-direction-${id}`}
            disabled={disabled}
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            {["left", "right", "up", "down"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Transition duration (s)" htmlFor={`transition-duration-${id}`}>
          <Input
            id={`transition-duration-${id}`}
            type="number"
            min="0.000021"
            step="any"
            required
            disabled={disabled}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            aria-invalid={Boolean(error)}
          />
        </Row>
        {compact ? (
          <Hint>{TRANSITION_HELP}</Hint>
        ) : (
          <FieldDescription>{TRANSITION_HELP}</FieldDescription>
        )}
        <Actions>
          <Button size="xs" type="submit" variant="outline" disabled={disabled}>
            {transition ? "Apply transition" : "Add transition"}
          </Button>
          {transition && (
            <Button
              size="xs"
              type="button"
              variant={compact ? "outline" : "ghost"}
              disabled={disabled}
              onClick={() => run({ removeTransition: { transitionID: transition.id } })}
            >
              Remove transition
            </Button>
          )}
        </Actions>
        {error && <FieldError role="alert">{error}</FieldError>}
      </Group>
    </form>
  );
}
export function TransitionInspector({ clip }: { clip: Clip }) {
  const { snapshot } = useEditorSession();
  const track = [...snapshot.project.videoTracks, ...snapshot.project.audioTracks].find((t) =>
    t.clips.some((c) => c.id === clip.id),
  )!;
  return (
    <>
      <InspectorSection id="transitions.add" title="Transitions" label="Transitions">
        <TransitionForm
          key={`add:${clip.id}:${snapshot.revision}`}
          track={track}
          clip={clip}
          compact
        />
      </InspectorSection>
      {track.transitions
        .filter((t) => t.fromClipID === clip.id || t.toClipID === clip.id)
        .map((t) => (
          <details key={String(t.id)} className="editor-effect editor-transition-item">
            <summary>
              {String(t.type)} · {String(t.duration)} s
            </summary>
            <div className="editor-effect-body">
              <TransitionForm
                key={`${t.id}:${snapshot.revision}`}
                track={track}
                transition={t}
                compact
              />
              <TransitionSoundControls
                key={`sound:${t.id}:${snapshot.revision}`}
                track={track}
                transition={t}
              />
            </div>
          </details>
        ))}
    </>
  );
}
export function TransitionBlock({
  track,
  transition,
  zoom,
  run,
}: {
  track: Track;
  transition: TransitionValue;
  zoom: number;
  run: (action: () => unknown) => void;
}) {
  const { session, snapshot } = useEditorSession();
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<number | null>(null);
  const drag = useRef<{ x: number; duration: number; revision: number } | null>(null);
  const window = transitionWindow(track, {
    ...transition,
    ...(draft == null ? {} : { duration: draft }),
  });
  if (!window) return null;
  const disabled = snapshot.readOnly || snapshot.busy || track.locked,
    tail = transition.toClipID == null;
  const finish = (commit: boolean) => {
    const current = drag.current;
    drag.current = null;
    setDraft(null);
    if (commit && current && draft != null)
      run(() =>
        session.apply({
          label: "Resize transition",
          expectedRevision: current.revision,
          commands: [
            { updateTransition: { transitionID: transition.id, patch: { duration: draft } } },
          ],
        }),
      );
  };
  return (
    <div
      className="editor-transition"
      style={{ left: window.start * zoom, width: Math.max(18, window.duration * zoom) }}
      onClick={(e) => e.stopPropagation()}
    >
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button size="xs" variant="outline" disabled={disabled} />}>
          {String(transition.type)}
        </DialogTrigger>
        <DialogContent className="dark editor-dialog editor-dialog-form">
          <DialogHeader>
            <DialogTitle>Edit transition</DialogTitle>
          </DialogHeader>
          <TransitionForm
            key={`${transition.id}:${snapshot.revision}`}
            track={track}
            transition={transition}
          />
        </DialogContent>
      </Dialog>
      <button
        className="editor-transition-handle"
        style={tail ? { left: 0, right: "auto" } : undefined}
        type="button"
        disabled={disabled}
        aria-label={`Resize ${transition.type} transition`}
        title="Drag to change duration. Escape cancels; use the transition button for numeric controls."
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, duration: window.duration, revision: snapshot.revision };
          setDraft(window.duration);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setDraft(
              Math.max(
                1 / 48000,
                drag.current.duration +
                  ((e.clientX - drag.current.x) / zoom) *
                    (transition.fromClipID != null && transition.toClipID != null
                      ? 2
                      : tail
                        ? -1
                        : 1),
              ),
            );
        }}
        onPointerUp={() => finish(true)}
        onPointerCancel={() => finish(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") finish(false);
        }}
      >
        <RiArrowLeftRightLine aria-hidden="true" />
      </button>
    </div>
  );
}
