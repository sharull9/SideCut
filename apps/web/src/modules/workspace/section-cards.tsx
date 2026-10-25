import { useState } from "react";
import type { Clip } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import { markerKind } from "@sidecut/contracts/project";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@sidecut/ui/components/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@sidecut/ui/components/dialog";
import {
  CONVEX,
  cardOf,
  cardParams,
  cardPlacements,
  fittedDuration,
  hexString,
  parseHex,
  type CardProps,
} from "@sidecut/core/section-cards";
import { CommitInput } from "./commit-input";
import { RiPresentationLine } from "@remixicon/react";
import { useEditorSession } from "./editor-session";
import { ToolTip } from "./tool-tip";
import "./dialogs.css";

export function SectionCardsDialog() {
  const { session, snapshot } = useEditorSession();
  const [open, setOpen] = useState(false),
    [kicker, setKicker] = useState("Section"),
    [duration, setDuration] = useState(""),
    [mode, setMode] = useState<"overwrite" | "insert">("overwrite"),
    [soundIn, setSoundIn] = useState(""),
    [soundOut, setSoundOut] = useState(""),
    [error, setError] = useState<string | null>(null),
    [done, setDone] = useState<string | null>(null);
  const disabled = snapshot.readOnly || snapshot.busy;
  const project = snapshot.project;
  const sounds = project.media.filter((m) => m.hasAudio);
  const sections = project.markers.filter((m) => markerKind(m) === "section" && m.time > 0);
  let preview: ReturnType<typeof cardPlacements> | null = null,
    issue: string | null = null;
  try {
    const length = Number(duration);
    preview = cardPlacements(
      project,
      null,
      duration && length >= 1 ? Time.fromSeconds(length) : null,
      kicker,
    );
  } catch (cause) {
    issue = cause instanceof Error ? cause.message : String(cause);
  }
  const apply = (label: string, command: unknown) => {
    setError(null);
    try {
      const result = session.apply({
        label,
        expectedRevision: snapshot.revision,
        commands: [command],
      });
      setDone(
        `${label}.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""} Undo reverses it in one step.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const sound = (id: string) => (id ? { mediaID: id } : null);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        setDone(null);
        setError(null);
      }}
    >
      <ToolTip label="Section cards">
        <DialogTrigger
          render={
            <Button
              size="xs"
              variant="ghost"
              className="editor-tool-button"
              aria-label="Section cards"
              disabled={disabled}
            />
          }
        >
          <RiPresentationLine data-icon="inline-start" aria-hidden="true" />
          <span className="editor-tool-text" aria-hidden="true">
            Section cards
          </span>
        </DialogTrigger>
      </ToolTip>
      <DialogContent className="dark editor-dialog editor-dialog-form">
        <DialogHeader>
          <DialogTitle>Section cards</DialogTitle>
          <DialogDescription>
            A numbered card at each section marker after the start, titled from the marker's name
            and note. Each card hides the frame from its marker on, so the cut isn't seen.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {sections.length > 0 ? (
            <ol className="editor-speech-results" aria-label="Section markers">
              {sections.map((marker, i) => {
                const placement = preview?.find((p) => p.marker.id === marker.id);
                return (
                  <li key={marker.id}>
                    <span className="editor-speech-time">{marker.time.toFixed(2)} s</span>
                    <span>
                      {String(i + 1).padStart(2, "0")} {marker.name || "Untitled"}
                    </span>
                    {placement && (
                      <span className="editor-speech-badge">
                        {placement.existingClipID
                          ? "renumber"
                          : `${placement.duration.seconds.toFixed(1)} s card`}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <FieldDescription>
              Add section markers (Markers strip, Kind: Section) first.
            </FieldDescription>
          )}
          <div className="editor-speech-grid">
            <Field>
              <FieldLabel htmlFor="cards-kicker">Kicker</FieldLabel>
              <Input id="cards-kicker" value={kicker} onChange={(e) => setKicker(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="cards-duration">Length (s)</FieldLabel>
              <Input
                id="cards-duration"
                type="number"
                min="1"
                step="0.1"
                placeholder="Fit to words"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="cards-mode">Timing</FieldLabel>
              <select
                id="cards-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as typeof mode)}
              >
                <option value="overwrite">Lay over the edit</option>
                <option value="insert">Make room in the take</option>
              </select>
            </Field>
            {(["in", "out"] as const).map((which) => (
              <Field key={which}>
                <FieldLabel htmlFor={`cards-sound-${which}`}>Sweep {which} sound</FieldLabel>
                <select
                  id={`cards-sound-${which}`}
                  value={which === "in" ? soundIn : soundOut}
                  onChange={(e) => (which === "in" ? setSoundIn : setSoundOut)(e.target.value)}
                >
                  <option value="">None</option>
                  {sounds.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.path}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          <FieldDescription>
            Making room inserts the card's hold into the take at each marker; the marker moves with
            the shot after it. Sounds go on an SFX track at -15 dB, linked to their card.
          </FieldDescription>
          {issue && sections.length > 0 && <FieldError>{issue}</FieldError>}
          {done && <p role="status">{done}</p>}
          {error && <FieldError role="alert">{error}</FieldError>}
          <div className="editor-dialog-actions">
            <Button
              size="sm"
              variant="outline"
              disabled={
                disabled || !project.videoTracks.some((t) => t.clips.some((c) => cardOf(c)))
              }
              onClick={() => apply("Fit section cards to text", { fitSectionCards: {} })}
            >
              Fit all cards to text
            </Button>
            <Button
              size="sm"
              disabled={disabled || !sections.length}
              onClick={() =>
                apply(`Add ${sections.length} section card${sections.length === 1 ? "" : "s"}`, {
                  addSectionCards: {
                    kicker: kicker.trim() || null,
                    duration: duration ? Number(duration) : null,
                    mode,
                    soundIn: sound(soundIn),
                    soundOut: sound(soundOut),
                  },
                })
              }
            >
              Add cards
            </Button>
          </div>
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}

export function CardInspector({ clip }: { clip: Clip }) {
  const { session, snapshot } = useEditorSession();
  const [error, setError] = useState<string | null>(null);
  const props = cardOf(clip);
  if (!props) return null;
  const track = snapshot.project.videoTracks.find((t) => t.clips.some((c) => c.id === clip.id));
  const disabled = snapshot.readOnly || snapshot.busy || track?.locked === true;
  const fitted = fittedDuration(props, snapshot.project.settings.frameRate);
  const update = (label: string, next: Partial<CardProps>) => {
    // Merge patch: fields a card no longer sets (cleared words, default colours) are removed.
    const before = cardParams(props),
      after = cardParams({ ...props, ...next });
    const patch: Record<string, unknown> = { ...after };
    for (const key of Object.keys(before)) if (!(key in after)) patch[key] = null;
    setError(null);
    try {
      session.apply({
        label,
        expectedRevision: snapshot.revision,
        commands: [
          { updateClip: { clipID: clip.id, patch: { content: { graphic: { props: patch } } } } },
        ],
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const id = (name: string) => `card-${clip.id}-${name}`;
  const text = (key: "title" | "subtitle" | "number" | "kicker", label: string) => (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={id(key)}>{label}</FieldLabel>
      <Input
        key={`${key}:${props[key]}`}
        id={id(key)}
        defaultValue={props[key]}
        disabled={disabled}
        onBlur={(e) =>
          e.target.value !== props[key] && update(`Edit card ${key}`, { [key]: e.target.value })
        }
      />
    </Field>
  );
  return (
    <div className="editor-trim-form editor-text-inspector">
      <h3>Section card</h3>
      <FieldGroup>
        {text("title", "Title")}
        {text("subtitle", "Subtitle")}
        {text("number", "Number")}
        {text("kicker", "Kicker")}
        <Field orientation="horizontal">
          <FieldLabel htmlFor={id("total")}>Sections</FieldLabel>
          <CommitInput
            id={id("total")}
            value={props.total}
            min={0}
            max={999}
            step={1}
            disabled={disabled}
            onCommit={(v) => update("Set card section count", { total: Math.round(Number(v)) })}
          />
        </Field>
        {(["accent", "band2", "band3", "background"] as const).map((key) => (
          <Field key={key} orientation="horizontal">
            <FieldLabel htmlFor={id(key)}>
              {key === "band2"
                ? "Band 2"
                : key === "band3"
                  ? "Band 3"
                  : key[0]!.toUpperCase() + key.slice(1)}
            </FieldLabel>
            <input
              id={id(key)}
              type="color"
              disabled={disabled}
              value={hexString(props.colors[key]).toLowerCase()}
              onChange={(e) =>
                update(`Set card ${key}`, {
                  colors: { ...props.colors, [key]: parseHex(e.target.value) ?? CONVEX[key] },
                })
              }
            />
          </Field>
        ))}
        <Field orientation="horizontal">
          <input
            id={id("cursor")}
            type="checkbox"
            checked={props.cursor}
            disabled={disabled}
            onChange={(e) => update("Toggle card cursor", { cursor: e.target.checked })}
          />
          <FieldLabel htmlFor={id("cursor")}>Blinking cursor after the title</FieldLabel>
        </Field>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || fitted.flicks === clip.duration.flicks}
          onClick={() => {
            setError(null);
            try {
              session.apply({
                label: "Fit section card to text",
                expectedRevision: snapshot.revision,
                commands: [{ fitSectionCards: { clipIDs: [clip.id] } }],
              });
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          Fit to text ({fitted.seconds.toFixed(1)} s)
        </Button>
        <FieldDescription>
          Words are read at 15 characters a second, plus 2.2 s for the wipes, kept to 4-7 s.
        </FieldDescription>
      </FieldGroup>
      {error && <FieldError role="alert">{error}</FieldError>}
    </div>
  );
}
