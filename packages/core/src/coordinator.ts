import { Schema } from "effect";
import { EditBatchSchema } from "@sidecut/contracts/commands";
import type { EditCommand } from "@sidecut/contracts/commands";
import { MediaItemSchema, ProjectSettingsSchema } from "@sidecut/contracts/project";
import type { Project, ProjectFile } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import { validateProject } from "./validation";
import type { ValidationIssue } from "./validation";

type Json = typeof Schema.Json.Type;
type JsonObject = typeof Schema.JsonObject.Type;

export class EditError extends Error {
  constructor(
    readonly code: "invalid" | "stale-revision" | "validation" | "busy",
    message: string,
    readonly objectID?: string,
  ) {
    super(message);
    this.name = "EditError";
  }
}

export interface CommitResult {
  readonly revision: number;
  readonly label: string;
  readonly author: string;
  readonly createdIDs: readonly string[];
  readonly warnings: readonly string[];
}

export interface SessionSnapshot extends ProjectFile {
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  readonly lastChange: {
    readonly kind: "edit" | "undo" | "redo";
    readonly label: string;
    readonly author: string;
  } | null;
}

interface UndoEntry {
  label: string;
  author: string;
  before: Project;
  after: Project;
}

function clone<T>(value: T): T {
  if (value instanceof Time) return new Time(value.flicks) as T;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

function object(value: Json): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

// RFC 7396: null removes a key, objects merge recursively, other values replace.
function mergePatch(current: Json, patch: Json): Json {
  const fields = object(patch);
  if (!fields) return patch;
  const result = new Map(Object.entries(object(current) ?? {}));
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) result.delete(key);
    else result.set(key, mergePatch(result.get(key) ?? null, value));
  }
  return Object.fromEntries(result);
}

function applyCommand(project: Project, command: EditCommand, warnings: string[]): Project {
  if ("addMedia" in command) {
    const item = command.addMedia.item;
    const ids = [
      project.id,
      ...project.media.map((media) => media.id),
      ...project.markers.map((marker) => marker.id),
      ...[...project.videoTracks, ...project.audioTracks].flatMap((track) => [
        track.id,
        ...track.clips.map((clip) => clip.id),
        ...track.transitions.map((transition) => transition.id),
      ]),
    ];
    if (ids.includes(item.id))
      throw new EditError("invalid", `Duplicate ID ${item.id} (already in use).`);
    if (!item.path) throw new EditError("invalid", "media needs a path");
    return { ...project, media: [...project.media, item] };
  }
  if ("updateMedia" in command) {
    const { mediaID, patch } = command.updateMedia;
    const item = project.media.find((media) => media.id === mediaID);
    if (!item) throw new EditError("invalid", `media ${mediaID} not found`);
    if ("id" in patch) throw new EditError("invalid", "media patch cannot change id");
    const updated = Schema.decodeUnknownSync(MediaItemSchema)(
      mergePatch(Schema.encodeSync(MediaItemSchema)(item) as Json, patch),
    );
    return {
      ...project,
      media: project.media.map((media) => (media.id === mediaID ? updated : media)),
    };
  }
  if ("removeMedia" in command) {
    const { mediaID } = command.removeMedia;
    if (!project.media.some((item) => item.id === mediaID))
      throw new EditError("invalid", `media ${mediaID} not found`);
    const users = [...project.videoTracks, ...project.audioTracks]
      .flatMap((track) => track.clips)
      .filter((clip) => {
        const content = clip.content.media;
        return (
          content &&
          typeof content === "object" &&
          "mediaID" in content &&
          content.mediaID === mediaID
        );
      });
    if (users.length)
      throw new EditError(
        "invalid",
        `media ${mediaID} is used by ${users.length} clip(s); remove them first`,
      );
    return { ...project, media: project.media.filter((item) => item.id !== mediaID) };
  }
  if ("updateProject" in command) {
    const patch = command.updateProject.patch;
    for (const key of Object.keys(patch))
      if (key !== "name" && key !== "metadata")
        throw new EditError(
          "invalid",
          `updateProject can change name and metadata (use updateSettings for "${key}")`,
        );
    const Header = Schema.Struct({
      name: Schema.String,
      metadata: Schema.Record(Schema.String, Schema.String),
    });
    const header = Schema.decodeUnknownSync(Header)(
      mergePatch({ name: project.name, metadata: project.metadata }, patch),
    );
    return { ...project, ...header };
  }
  const old = project.settings;
  const settings = Schema.decodeUnknownSync(ProjectSettingsSchema)(
    mergePatch(Schema.encodeSync(ProjectSettingsSchema)(old) as Json, command.updateSettings.patch),
  );
  if (
    settings.frameRate.numerator !== old.frameRate.numerator ||
    settings.frameRate.denominator !== old.frameRate.denominator
  )
    warnings.push(
      `Frame rate changed to ${settings.frameRate.numerator / settings.frameRate.denominator} fps. Existing cuts keep their times, so some may fall between frames.`,
    );
  let audioTracks = project.audioTracks;
  if (settings.speechLoudness !== old.speechLoudness) {
    if (settings.speechLoudness < -40 || settings.speechLoudness > -10)
      throw new EditError("invalid", "the speech level must be between -40 and -10 LUFS");
    audioTracks = audioTracks.map((track) => {
      if (!track.clips.some((clip) => clip.audio?.normalizeTo === old.speechLoudness)) return track;
      if (track.locked) {
        warnings.push(
          `Locked track "${track.name}" keeps its clips at ${old.speechLoudness} LUFS.`,
        );
        return track;
      }
      return {
        ...track,
        clips: track.clips.map((clip) =>
          clip.audio?.normalizeTo === old.speechLoudness
            ? { ...clip, audio: { ...clip.audio, normalizeTo: settings.speechLoudness } }
            : clip,
        ),
      };
    });
  }
  return { ...project, settings, audioTracks };
}

export class ProjectCoordinator {
  private state: SessionSnapshot;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private results = new Map<string, CommitResult>();
  private listeners = new Set<() => void>();
  private publishing = false;

  constructor(file: ProjectFile) {
    this.assertValid(file.project);
    this.state = freeze({ ...clone(file), undoLabel: null, redoLabel: null, lastChange: null });
  }

  getSnapshot = (): SessionSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  apply(input: unknown): CommitResult {
    this.assertAvailable();
    let batch;
    try {
      batch = Schema.decodeUnknownSync(EditBatchSchema, { onExcessProperty: "error" })(input);
    } catch (error) {
      throw new EditError("invalid", error instanceof Error ? error.message : String(error));
    }
    if (batch.idempotencyKey != null) {
      const previous = this.results.get(batch.idempotencyKey);
      if (previous) return previous;
    }
    if (batch.expectedRevision != null && batch.expectedRevision !== this.state.revision)
      throw new EditError(
        "stale-revision",
        `Stale revision: expected ${batch.expectedRevision}, actual ${this.state.revision}.`,
      );
    this.assertRevision();
    let working = this.state.project;
    const warnings: string[] = [];
    for (const [index, command] of batch.commands.entries()) {
      try {
        working = applyCommand(working, command, warnings);
      } catch (error) {
        throw new EditError(
          "invalid",
          `${batch.commands.length > 1 ? `command ${index + 1} of ${batch.commands.length}: ` : ""}${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const issues = this.assertValid(working);
    const existingWarnings = new Set(
      validateProject(this.state.project)
        .filter((issue) => issue.severity === "warning")
        .map((issue) => `${issue.objectID}|${issue.message}`),
    );
    warnings.push(
      ...issues
        .filter(
          (issue) =>
            issue.severity === "warning" &&
            !existingWarnings.has(`${issue.objectID}|${issue.message}`),
        )
        .map((issue) => issue.message),
    );
    const after = freeze(clone(working));
    const entry = { label: batch.label, author: batch.author, before: this.state.project, after };
    this.undoStack.push(entry);
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack = [];
    const result = freeze({
      revision: this.state.revision + 1,
      label: batch.label,
      author: batch.author,
      createdIDs: [],
      warnings,
    });
    if (batch.idempotencyKey != null) this.results.set(batch.idempotencyKey, result);
    this.publish(after, result, "edit");
    return result;
  }

  undo(): CommitResult | null {
    return this.travel("undo");
  }
  redo(): CommitResult | null {
    return this.travel("redo");
  }

  private travel(kind: "undo" | "redo"): CommitResult | null {
    this.assertAvailable();
    const source = kind === "undo" ? this.undoStack : this.redoStack;
    const entry = source.at(-1);
    if (!entry) return null;
    this.assertRevision();
    source.pop();
    (kind === "undo" ? this.redoStack : this.undoStack).push(entry);
    const result = freeze({
      revision: this.state.revision + 1,
      label: `${kind === "undo" ? "Undo" : "Redo"} ${entry.label}`,
      author: entry.author,
      createdIDs: [],
      warnings: [],
    });
    this.publish(kind === "undo" ? entry.before : entry.after, result, kind);
    return result;
  }

  private publish(project: Project, result: CommitResult, kind: "edit" | "undo" | "redo") {
    this.state = freeze({
      ...this.state,
      project,
      revision: result.revision,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
      lastChange: { kind, label: result.label, author: result.author },
    });
    this.publishing = true;
    try {
      for (const listener of this.listeners) {
        // An observer must not turn a committed edit into an apparent failed mutation.
        try {
          listener();
        } catch {
          /* Observer failures do not roll back a committed edit. */
        }
      }
    } finally {
      this.publishing = false;
    }
  }

  private assertAvailable() {
    if (this.publishing)
      throw new EditError(
        "busy",
        "Wait until the current change has been delivered before submitting another edit.",
      );
  }

  private assertRevision() {
    if (!Number.isSafeInteger(this.state.revision + 1))
      throw new EditError("invalid", "Project revision exceeds the supported integer range.");
  }

  private assertValid(project: Project): ValidationIssue[] {
    const issues = validateProject(project);
    const error = issues.find((issue) => issue.severity === "error");
    if (error) throw new EditError("validation", error.message, error.objectID);
    return issues;
  }
}
