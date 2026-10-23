import { useState } from "react";
import { Time } from "@sidecut/contracts/time";
import { markerKind, markerKinds, type Marker } from "@sidecut/contracts/project";
import { CommentEdits, oneLine } from "@sidecut/core/markers";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldError, FieldGroup, FieldLabel } from "@sidecut/ui/components/field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@sidecut/ui/components/dialog";
import { useEditorSession, useEditorView } from "./editor-session";

const KIND_LABEL: Record<string, string> = {
  marker: "Marker",
  section: "Section",
  chapter: "Chapter",
  todo: "To do",
  comment: "Comment",
};

/** Marker, section, chapter and to-do flags in one strip, comments in the next. */
export function MarkerStrips({
  header,
  width,
  zoom,
  run,
}: {
  header: number;
  width: number;
  zoom: number;
  run: (action: () => unknown) => void;
}) {
  const { session, snapshot, editor } = useEditorSession();
  const playhead = useEditorView((s) => s.playhead);
  const [editing, setEditing] = useState<Marker | "new-comment" | null>(null);
  const disabled = snapshot.readOnly || snapshot.busy;
  const markers = [...snapshot.project.markers].sort((a, b) => a.time - b.time);
  const navigate = (direction: 1 | -1) => {
    const now = playhead.seconds;
    const next =
      direction > 0
        ? markers.find((m) => m.time > now + 1e-6)
        : markers.toReversed().find((m) => m.time < now - 1e-6);
    if (next) editor.getState().seek(Time.fromSeconds(next.time));
  };
  const lanes = [
    {
      id: "markers",
      label: "Markers",
      items: markers.filter((m) => markerKind(m) !== "comment"),
      add: () =>
        run(() =>
          session.apply({
            label: "Add marker",
            commands: [
              {
                addMarker: {
                  marker: {
                    time: playhead.seconds,
                    name: `Marker ${markers.filter((m) => markerKind(m) !== "comment").length + 1}`,
                  },
                },
              },
            ],
          }),
        ),
    },
    {
      id: "comments",
      label: "Comments",
      items: markers.filter((m) => markerKind(m) === "comment"),
      add: () => setEditing("new-comment"),
    },
  ];
  return (
    <>
      {lanes.map((lane) => (
        <div
          key={lane.id}
          className="editor-marker-strip"
          style={{ gridTemplateColumns: `${header}px ${width}px` }}
        >
          <div className="editor-marker-header">
            <span>{lane.label}</span>
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={lane.add}
              aria-label={
                lane.id === "markers" ? "Add marker at playhead" : "Add comment at playhead"
              }
            >
              +
            </Button>
            {lane.id === "markers" && (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label="Previous marker"
                  onClick={() => navigate(-1)}
                >
                  ‹
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label="Next marker"
                  onClick={() => navigate(1)}
                >
                  ›
                </Button>
              </>
            )}
          </div>
          <div className="editor-marker-lane" role="group" aria-label={lane.label}>
            {lane.items.map((marker) => {
              const kind = markerKind(marker);
              const text = oneLine(marker.name) || KIND_LABEL[kind];
              return (
                <button
                  key={marker.id}
                  type="button"
                  className="editor-marker"
                  data-kind={kind}
                  style={{ left: marker.time * zoom, width: Math.max(2, marker.duration * zoom) }}
                  title={`${KIND_LABEL[kind]} · ${marker.time.toFixed(2)} s${marker.note ? ` · ${marker.note}` : ""}. Double-click or Shift+Enter to edit.`}
                  aria-label={`${KIND_LABEL[kind]} ${text} at ${marker.time.toFixed(2)} seconds`}
                  onClick={() => editor.getState().seek(Time.fromSeconds(marker.time))}
                  onDoubleClick={() => setEditing(marker)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.shiftKey) setEditing(marker);
                  }}
                >
                  <span>{text}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {editing && (
        <MarkerDialog
          marker={editing === "new-comment" ? null : editing}
          at={playhead.seconds}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function MarkerDialog({
  marker,
  at,
  onClose,
}: {
  marker: Marker | null;
  at: number;
  onClose: () => void;
}) {
  const { session, snapshot } = useEditorSession();
  const comment = !marker || markerKind(marker) === "comment";
  const [name, setName] = useState(marker?.name ?? ""),
    [kind, setKind] = useState(marker?.kind ?? "comment"),
    [time, setTime] = useState(String(marker?.time ?? at)),
    [duration, setDuration] = useState(String(marker?.duration ?? 0)),
    [note, setNote] = useState(marker?.note ?? ""),
    [error, setError] = useState<string | null>(null);
  const disabled = snapshot.readOnly || snapshot.busy;
  const submit = (batch: { label: string; commands: unknown[] } | null) => {
    setError(null);
    try {
      if (batch) session.apply({ ...batch, expectedRevision: snapshot.revision });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="dark">
        <DialogHeader>
          <DialogTitle>
            {marker ? `Edit ${KIND_LABEL[markerKind(marker)]!.toLowerCase()}` : "Add comment"}
          </DialogTitle>
          <DialogDescription>
            Markers move with ripple edits. Comments are notes for the next round of edits; resolve
            one by deleting it.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!marker) return submit(CommentEdits.add(name, Number(time)));
            if (
              comment &&
              kind === "comment" &&
              Number(time) === marker.time &&
              Number(duration) === marker.duration &&
              note === (marker.note ?? "")
            )
              return submit(CommentEdits.edit(marker, name));
            const seconds = Number(time),
              length = Number(duration);
            if (!Number.isFinite(seconds) || !Number.isFinite(length))
              return setError("Enter times in seconds.");
            submit({
              label: `Edit ${KIND_LABEL[markerKind({ kind })]!.toLowerCase()}`,
              commands: [
                {
                  updateMarker: {
                    markerID: marker.id,
                    patch: {
                      name,
                      kind,
                      time: seconds,
                      duration: length,
                      note: note.trim() || null,
                    },
                  },
                },
              ],
            });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="marker-name">
                {comment && kind === "comment" ? "Comment" : "Name"}
              </FieldLabel>
              <textarea
                id="marker-name"
                className="editor-text-area"
                rows={comment ? 3 : 1}
                value={name}
                disabled={disabled}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            {marker && (
              <>
                <Field>
                  <FieldLabel htmlFor="marker-kind">Kind</FieldLabel>
                  <select
                    id="marker-kind"
                    value={kind}
                    disabled={disabled}
                    onChange={(event) => setKind(event.target.value)}
                  >
                    {markerKinds.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                    {!(markerKinds as readonly string[]).includes(kind) && (
                      <option value={kind}>{kind} (read as marker)</option>
                    )}
                  </select>
                </Field>
                <div className="editor-speech-grid">
                  <Field>
                    <FieldLabel htmlFor="marker-time">Time (s)</FieldLabel>
                    <Input
                      id="marker-time"
                      type="number"
                      min="0"
                      step="any"
                      value={time}
                      disabled={disabled}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="marker-duration">Range (s)</FieldLabel>
                    <Input
                      id="marker-duration"
                      type="number"
                      min="0"
                      step="any"
                      value={duration}
                      disabled={disabled}
                      onChange={(e) => setDuration(e.target.value)}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="marker-note">Note</FieldLabel>
                  <Input
                    id="marker-note"
                    value={note}
                    disabled={disabled}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
              </>
            )}
            <div className="editor-clip-edit-actions">
              <Button type="submit" size="sm" disabled={disabled}>
                {marker ? "Save" : "Add comment"}
              </Button>
              {marker && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() =>
                    submit(
                      comment
                        ? CommentEdits.remove([marker.id], "Resolve comment")
                        : {
                            label: "Remove marker",
                            commands: [{ removeMarker: { markerID: marker.id } }],
                          },
                    )
                  }
                >
                  {comment ? "Resolve" : "Delete"}
                </Button>
              )}
            </div>
            {error && <FieldError role="alert">{error}</FieldError>}
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
