import type { Project, Track, Clip } from "@sidecut/contracts/project";
import { Time, flicksPerFrame } from "@sidecut/contracts/time";

export interface ValidationIssue {
  readonly severity: "error" | "warning";
  readonly code: string;
  readonly message: string;
  readonly objectID: string;
}

// Ported from TandemCore/Validation.swift at the roadmap's pinned revision.
export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (
    code: string,
    message: string,
    objectID: string,
    severity: ValidationIssue["severity"] = "error",
  ) => {
    issues.push({ code, message, objectID, severity });
  };
  const seen = new Set<string>();
  const claim = (id: unknown, what: string) => {
    if (typeof id !== "string" || !id) {
      issue("invalid-id", `${what} needs an ID.`, project.id);
      return;
    }
    if (seen.has(id)) issue("duplicate-id", `Duplicate ID ${id} (${what}).`, id);
    seen.add(id);
  };
  if (project.settings.width <= 0 || project.settings.height <= 0)
    issue("canvas-size", "Canvas size must be positive.", project.id);
  let frame = 0n;
  try {
    frame = flicksPerFrame(project.settings.frameRate);
  } catch {
    issue("frame-rate", "Frame rate must be positive.", project.id);
  }

  const tracks = [...project.videoTracks, ...project.audioTracks];
  for (const media of project.media) claim(media.id, "media");
  for (const track of tracks) {
    claim(track.id, "track");
    for (const clip of track.clips) claim(clip.id, "clip");
    for (const transition of track.transitions) claim(transition.id, "transition");
  }
  for (const marker of project.markers) claim(marker.id, "marker");
  for (const [expectedKind, list] of [
    ["video", project.videoTracks],
    ["audio", project.audioTracks],
  ] as const) {
    for (const track of list)
      if (track.kind !== expectedKind)
        issue(
          "track-kind",
          `Track ${track.id} must be ${expectedKind} in this track collection.`,
          track.id,
        );
  }

  const mediaByID = new Map(project.media.map((item) => [item.id, item]));
  const groups = new Map<string, Clip[]>();
  const audioIDs = new Set(project.audioTracks.flatMap((t) => t.clips.map((c) => c.id)));
  const soundTies = new Set<string>();
  for (const track of tracks) {
    let previous: Clip | undefined;
    for (const clip of track.clips) {
      if (clip.duration.flicks <= 0n)
        issue("clip-duration", `Clip ${clip.id} on "${track.name}" has no duration.`, clip.id);
      if (clip.start.flicks < 0n) issue("clip-start", `Clip ${clip.id} starts before 0.`, clip.id);
      if (!Number.isFinite(clip.speed) || clip.speed <= 0)
        issue("clip-speed", `Clip ${clip.id} has speed ${clip.speed}.`, clip.id);
      if (previous) {
        if (clip.start.flicks < previous.start.flicks)
          issue("clip-order", `Clips on "${track.name}" are out of order.`, clip.id);
        else if (clip.start.flicks < previous.start.flicks + previous.duration.flicks)
          issue(
            "clip-overlap",
            `Clips ${previous.id} and ${clip.id} overlap on "${track.name}".`,
            clip.id,
          );
      }
      previous = clip;
      if (clip.linkGroup) groups.set(clip.linkGroup, [...(groups.get(clip.linkGroup) ?? []), clip]);
      const effects = clip.video?.effects;
      if (Array.isArray(effects)) {
        const ids = effects.map((effect) =>
          effect && typeof effect === "object" && "id" in effect ? effect.id : undefined,
        );
        if (new Set(ids).size !== ids.length)
          issue("effect-id", `Clip ${clip.id} has two effects with the same ID.`, clip.id);
      }
      const mediaContent = clip.content.media;
      if (mediaContent && typeof mediaContent === "object" && "mediaID" in mediaContent) {
        const item = mediaByID.get(String(mediaContent.mediaID));
        if (!item)
          issue(
            "missing-media",
            `Clip ${clip.id} uses missing media ${String(mediaContent.mediaID)}.`,
            clip.id,
          );
        else {
          if (track.kind === "video" && !(item.hasVideo || item.kind === "image"))
            issue(
              "no-picture",
              `Clip ${clip.id} on video track "${track.name}" has no picture.`,
              clip.id,
            );
          if (track.kind === "audio" && !item.hasAudio)
            issue(
              "no-sound",
              `Clip ${clip.id} on audio track "${track.name}" has no sound.`,
              clip.id,
            );
          if (item.kind !== "image" && !clip.holdEdges) {
            if (clip.sourceStart.flicks < -frame)
              issue(
                "source-start",
                `Clip ${clip.id} starts before the beginning of ${item.path}.`,
                clip.id,
              );
            try {
              const sourceEnd = clip.sourceStart.add(
                clip.freezeFrame ? new Time(0n) : clip.duration.scaled(clip.speed),
              );
              if (item.duration && sourceEnd.flicks > item.duration.flicks + frame)
                issue("source-end", `Clip ${clip.id} runs past the end of ${item.path}.`, clip.id);
            } catch {
              issue(
                "source-range",
                `Clip ${clip.id} source range exceeds supported timing bounds.`,
                clip.id,
              );
            }
          }
        }
      } else if (track.kind === "audio")
        issue(
          "non-media-audio",
          `Audio track "${track.name}" holds a non-media clip ${clip.id}.`,
          clip.id,
        );
      for (const [path, keys] of Object.entries(clip.keyframes)) {
        let last = -Infinity;
        for (const key of keys) {
          if (typeof key.time !== "number" || !Number.isFinite(key.time)) {
            issue(
              "keyframe-time",
              `Keyframe for ${path} on clip ${clip.id} needs a finite time.`,
              clip.id,
            );
            break;
          }
          if (key.time < last) {
            issue(
              "keyframe-order",
              `Keyframes for ${path} on clip ${clip.id} are out of order.`,
              clip.id,
              "warning",
            );
            break;
          }
          last = key.time;
        }
      }
    }
    validateTransitions(track, issue, audioIDs, soundTies);
  }
  for (const [group, members] of groups)
    if (members.length === 1)
      issue("single-link", `Link group ${group} has only one clip.`, members[0]!.id, "warning");
  return issues;
}

function validateTransitions(
  track: Track,
  issue: (
    code: string,
    message: string,
    id: string,
    severity?: ValidationIssue["severity"],
  ) => void,
  audioIDs: Set<string>,
  soundTies: Set<string>,
) {
  const clips = new Map(track.clips.map((clip) => [clip.id, clip]));
  const tails = new Set<string>();
  const heads = new Set<string>();
  for (const transition of track.transitions) {
    const id = typeof transition.id === "string" ? transition.id : track.id;
    if (
      typeof transition.duration !== "number" ||
      !Number.isFinite(transition.duration) ||
      transition.duration <= 0
    )
      issue("transition-duration", `Transition ${id} has no duration.`, id);
    const fromID = typeof transition.fromClipID === "string" ? transition.fromClipID : null;
    const toID = typeof transition.toClipID === "string" ? transition.toClipID : null;
    const from = fromID ? clips.get(fromID) : undefined;
    const to = toID ? clips.get(toID) : undefined;
    if (!fromID && !toID)
      issue("transition-unattached", `Transition ${id} isn't attached to a clip.`, id);
    if ((fromID && !from) || (toID && !to))
      issue(
        "transition-clip",
        `Transition ${id} refers to a clip that isn't on "${track.name}".`,
        id,
      );
    if (from && to && from.start.flicks + from.duration.flicks !== to.start.flicks)
      issue("transition-gap", `Transition ${id} joins clips that don't meet.`, id);
    if (fromID) {
      if (tails.has(fromID))
        issue("transition-tail", `Clip ${fromID} has two transitions at its end.`, id);
      tails.add(fromID);
    }
    if (toID) {
      if (heads.has(toID))
        issue("transition-head", `Clip ${toID} has two transitions at its start.`, id);
      heads.add(toID);
    }
    if (track.kind === "audio" && transition.type !== "dissolve")
      issue(
        "audio-crossfade",
        `Audio transitions are always crossfades; ${String(transition.type)} plays as one.`,
        id,
        "warning",
      );
    if (typeof transition.soundClipID === "string") {
      if (!audioIDs.has(transition.soundClipID))
        issue(
          "transition-sound",
          `Transition ${id}'s sound ${transition.soundClipID} isn't a clip on an audio track.`,
          id,
        );
      if (soundTies.has(transition.soundClipID))
        issue(
          "shared-sound",
          `Clip ${transition.soundClipID} is the sound of two transitions.`,
          id,
        );
      soundTies.add(transition.soundClipID);
    }
  }
}
