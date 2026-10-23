// Ported from TandemCore/Editing.swift (markers) and TandemCore/Comments.swift.
// See tests/fixtures/tandem/TANDEM-LICENSE.
import { Schema } from "effect";
import { MarkerSchema, markerKind, type Marker, type Project } from "@sidecut/contracts/project";
import type { EditCommand } from "@sidecut/contracts/commands";
import { mergePatch } from "./json-merge-patch";
import type { EditContext } from "./timeline-editing";

type Json = typeof Schema.Json.Type;
const byTime = (a: Marker, b: Marker) => a.time - b.time;
const ids = (p: Project) => [
  p.id,
  ...p.media.map((m) => m.id),
  ...p.markers.map((m) => m.id),
  ...[...p.videoTracks, ...p.audioTracks].flatMap((t) => [
    t.id,
    ...t.clips.map((c) => c.id),
    ...t.transitions.map((x) => String(x.id)),
  ]),
];

export function editMarkers(
  p: Project,
  command: EditCommand,
  context: EditContext,
): Project | null {
  if ("addMarker" in command) {
    const marker = command.addMarker.marker;
    if (ids(p).includes(marker.id)) throw new Error(`ID ${marker.id} is already in use.`);
    if (!(marker.time >= 0) || !(marker.duration >= 0))
      throw new Error("Markers need a time of 0 or later.");
    context.createdIDs.push(marker.id);
    return { ...p, markers: [...p.markers, marker].sort(byTime) };
  }
  if ("updateMarker" in command) {
    const { markerID, patch } = command.updateMarker;
    const marker = p.markers.find((m) => m.id === markerID);
    if (!marker) throw new Error(`Marker ${markerID} not found.`);
    if ("id" in patch) throw new Error("Marker patch cannot change id.");
    const next = Schema.decodeUnknownSync(MarkerSchema)(
      mergePatch(Schema.encodeSync(MarkerSchema)(marker) as Json, patch),
    );
    return { ...p, markers: p.markers.map((m) => (m.id === markerID ? next : m)).sort(byTime) };
  }
  if ("removeMarker" in command) {
    const { markerID } = command.removeMarker;
    if (!p.markers.some((m) => m.id === markerID)) throw new Error(`Marker ${markerID} not found.`);
    return { ...p, markers: p.markers.filter((m) => m.id !== markerID) };
  }
  return null;
}

/** Comments waiting for the next round of edits, earliest first. */
export const comments = (p: Project) => p.markers.filter((m) => markerKind(m) === "comment");

/** What a comment keeps of what was typed: no spaces or blank lines at either end. */
export const tidyComment = (text: string) => text.trim();
/** A comment on one line, for the ruler and lists. */
export const oneLine = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" / ");

export const CommentEdits = {
  add(text: string, at: number, id?: string) {
    const name = tidyComment(text);
    if (!name) return null;
    return {
      label: "Add comment",
      commands: [
        {
          addMarker: {
            marker: { ...(id ? { id } : {}), time: Math.max(0, at), name, kind: "comment" },
          },
        },
      ],
    };
  },
  /** Emptied, it goes; unchanged, there is nothing to do. */
  edit(comment: Marker, text: string) {
    const name = tidyComment(text);
    if (!name) return CommentEdits.remove([comment.id]);
    if (name === comment.name) return null;
    return {
      label: "Edit comment",
      commands: [{ updateMarker: { markerID: comment.id, patch: { name } } }],
    };
  },
  remove(markerIDs: readonly string[], label?: string) {
    return {
      label:
        label ??
        (markerIDs.length === 1 ? "Delete comment" : `Delete ${markerIDs.length} comments`),
      commands: markerIDs.map((markerID) => ({ removeMarker: { markerID } })),
    };
  },
};
