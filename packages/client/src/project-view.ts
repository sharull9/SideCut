import {
  decodeProjectFile,
  encodeProjectFile,
  TransitionSchema,
  type Project,
  type Clip,
  type Track,
  type Transition,
} from "@sidecut/contracts/project";
import { Schema } from "effect";
import type { Time } from "@sidecut/contracts/time";

/** Wire values derive from the decoded project model, with exact times encoded as seconds. */
export type Wire<T> = T extends Time
  ? number
  : T extends readonly (infer Item)[]
    ? Wire<Item>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
export type ClipOn = Wire<Clip> & { track: Wire<Track>; end: number };
export type TransitionOn = Wire<Transition> & { track: Wire<Track> };

export class ProjectView {
  readonly json: Wire<Project>;
  constructor(
    input: unknown,
    readonly revision: number,
  ) {
    // Validate and normalize through the authoritative schema before converting
    // the same decoded model to its JSON representation.
    const file = decodeProjectFile({ revision, project: input });
    this.json = JSON.parse(encodeProjectFile(file)).project as Wire<Project>;
  }
  get tracks() {
    return [...this.json.videoTracks, ...this.json.audioTracks];
  }
  track(nameOrID: string) {
    const track = this.tracks.find((item) => item.id === nameOrID || item.name === nameOrID);
    if (!track)
      throw new Error(
        `No track "${nameOrID}". Tracks: ${this.tracks.map((item) => item.name).join(", ")}`,
      );
    return track;
  }
  clips(filter: (clip: ClipOn) => boolean = () => true): ClipOn[] {
    return this.tracks
      .flatMap((track) =>
        track.clips.map((clip) => ({ ...clip, track, end: clip.start + clip.duration })),
      )
      .filter(filter)
      .sort((a, b) => a.start - b.start);
  }
  clip(id: string) {
    const clip = this.clips((item) => item.id === id)[0];
    if (!clip) throw new Error(`No clip ${id}.`);
    return clip;
  }
  at(time: number) {
    if (!Number.isFinite(time) || time < 0) throw new Error("Time must be nonnegative seconds.");
    // Preserve visual stacking even when overlapping clips have different starts.
    return [...this.json.videoTracks]
      .reverse()
      .concat(this.json.audioTracks)
      .flatMap((track) =>
        track.clips
          .filter((clip) => clip.enabled && clip.start <= time && time < clip.start + clip.duration)
          .map((clip) => ({ ...clip, track, end: clip.start + clip.duration })),
      );
  }
  transitions(filter: (transition: TransitionOn) => boolean = () => true): TransitionOn[] {
    return this.tracks
      .flatMap((track) =>
        track.transitions.map((input) => ({
          ...Schema.decodeUnknownSync(TransitionSchema)(input),
          track,
        })),
      )
      .filter(filter);
  }
  captions() {
    return this.clips(
      (clip) => clip.track.name === "Captions" || clip.tags.includes("captions"),
    ).flatMap((clip) => {
      const text = clip.content.text;
      return text &&
        typeof text === "object" &&
        !Array.isArray(text) &&
        "text" in text &&
        typeof text.text === "string"
        ? [{ ...clip, text: text.text }]
        : [];
    });
  }
  media(query: string) {
    const path = query.replaceAll("\\", "/");
    const media =
      this.json.media.find(
        (item) =>
          item.id === query ||
          item.path.replaceAll("\\", "/") === path ||
          item.path.replaceAll("\\", "/").endsWith(`/${path}`),
      ) ?? this.json.media.find((item) => item.role === query);
    if (!media) throw new Error(`No media "${query}".`);
    return media;
  }
}
