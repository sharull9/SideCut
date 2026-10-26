import { useEffect, useRef, useState } from "react";
import { useEditorSession } from "./editor-session";
import type { Project } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import { shortcut, protectsEditing, ownsKey } from "./keyboard";
import { copyClips, pasteClips, type ClipClipboard } from "./clipboard";
import { projectDuration, stepFrame, atFrame } from "./timeline-model";
import { playheadTrim } from "./playhead-trim";

export function selectionWithLinks(project: Project, ids: readonly string[]): string[] {
  const clips = [...project.videoTracks, ...project.audioTracks].flatMap((t) => t.clips);
  const groups = new Set(
    clips.filter((c) => ids.includes(c.id) && c.linkGroup).map((c) => c.linkGroup),
  );
  return clips
    .filter((c) => ids.includes(c.id) || (c.linkGroup && groups.has(c.linkGroup)))
    .map((c) => c.id);
}
export function useEditActions(run: (action: () => unknown) => void, fitTimeline: () => void) {
  const { session, editor, snapshot } = useEditorSession();
  const clipboard = useRef<ClipClipboard | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
  const copy = () =>
    run(() => {
      clipboard.current = copyClips(session.getSnapshot().project, editor.getState().selected);
      setHasClipboard(true);
    });
  const paste = () =>
    run(async () => {
      if (!clipboard.current) return;
      const commands = pasteClips(
        session.getSnapshot().project,
        clipboard.current,
        editor.getState().playhead.seconds,
        () => `clip_${crypto.randomUUID()}`,
      );
      await session.apply({ label: "Paste clips", commands });
      editor.getState().selectMany(commands.map((command) => command.insertClip.clip.id));
    });
  const split = () =>
    run(() => {
      const state = editor.getState();
      const tracks = [...snapshot.project.videoTracks, ...snapshot.project.audioTracks];
      const ids = tracks
        .flatMap((t) => t.clips)
        .filter(
          (c) =>
            state.selected.includes(c.id) &&
            c.start.flicks < state.playhead.flicks &&
            state.playhead.flicks < c.start.flicks + c.duration.flicks,
        )
        .map((c) => c.id);
      if (
        !ids.length &&
        !tracks.some(
          (t) =>
            t.targeted &&
            !t.locked &&
            t.clips.some(
              (c) =>
                c.start.flicks < state.playhead.flicks &&
                state.playhead.flicks < c.start.flicks + c.duration.flicks,
            ),
        )
      )
        return;
      return session.apply({
        label: "Split at playhead",
        commands: [
          {
            blade: {
              at: state.playhead.seconds,
              ...(ids.length ? { clipIDs: ids } : {}),
            },
          },
        ],
      });
    });
  const remove = (ripple = false) =>
    run(() => {
      const ids = editor.getState().selected;
      if (!ids.length) return;
      return session.apply({
        label: ripple ? "Ripple delete selection" : "Lift selection",
        commands: [{ removeClips: { clipIDs: ids, ripple } }],
      });
    });
  const link = () =>
    run(() =>
      session.apply({
        label: "Link selection",
        commands: [{ link: { clipIDs: editor.getState().selected } }],
      }),
    );
  const unlink = () =>
    run(() =>
      session.apply({
        label: "Unlink selection",
        commands: [{ unlink: { clipIDs: editor.getState().selected } }],
      }),
    );
  const addMarker = () =>
    run(() =>
      session.apply({
        label: "Add marker",
        commands: [
          {
            addMarker: {
              marker: {
                time: editor.getState().playhead.seconds,
                name: `Marker ${session.getSnapshot().project.markers.length + 1}`,
              },
            },
          },
        ],
      }),
    );
  const addTrack = (kind: "video" | "audio") =>
    run(() => session.apply({ label: `Add ${kind} track`, commands: [{ addTrack: { kind } }] }));
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (protectsEditing(event.target)) return;
      const state = editor.getState(),
        action = shortcut(event, state.keymap);
      if (!action || ownsKey(event.target, action)) return;
      const current = session.getSnapshot(),
        project = current.project;
      if (current.saveState === "loading") return;
      if (
        (current.readOnly || current.busy) &&
        [
          "split",
          "remove",
          "rippleRemove",
          "undo",
          "redo",
          "paste",
          "toggleLink",
          "nudgeLeft",
          "nudgeRight",
          "addMarker",
          "addVideoTrack",
          "addAudioTrack",
          "rippleTrimStart",
          "rippleTrimEnd",
        ].includes(action)
      )
        return;
      if (
        event.repeat &&
        [
          "split",
          "remove",
          "rippleRemove",
          "undo",
          "redo",
          "copy",
          "paste",
          "toggleLink",
          "addMarker",
          "addVideoTrack",
          "addAudioTrack",
          "rippleTrimStart",
          "rippleTrimEnd",
          "toggleSnapping",
        ].includes(action)
      )
        return;
      event.preventDefault();
      if (action === "split") split();
      else if (action === "remove" || action === "rippleRemove") remove(action === "rippleRemove");
      else if (action === "undo" || action === "redo") run(() => session[action]());
      else if (action === "copy") copy();
      else if (action === "paste") paste();
      else if (action === "addMarker") addMarker();
      else if (action === "addVideoTrack" || action === "addAudioTrack")
        addTrack(action === "addVideoTrack" ? "video" : "audio");
      else if (action === "rippleTrimStart" || action === "rippleTrimEnd")
        run(async () => {
          const plan = playheadTrim({
            project,
            playhead: state.playhead,
            selected: state.selected,
            edge: action === "rippleTrimStart" ? "start" : "end",
          });
          if (!plan) return;
          await session.apply({ label: plan.label, commands: plan.commands });
          editor.getState().seek(plan.playhead);
        });
      else if (action === "toggleLink") {
        const selected = [...project.videoTracks, ...project.audioTracks]
          .flatMap((track) => track.clips)
          .filter((clip) => state.selected.includes(clip.id));
        if (
          selected[0]?.linkGroup &&
          selected.every((clip) => clip.linkGroup === selected[0]?.linkGroup)
        )
          unlink();
        else if (selected.length > 1) link();
      } else if (action === "selectAll") {
        state.select(null);
        for (const clip of [...project.videoTracks, ...project.audioTracks].flatMap((t) => t.clips))
          editor.getState().select(clip.id, true);
      } else if (action === "selectForward") {
        state.selectMany(
          [...project.videoTracks, ...project.audioTracks].flatMap((track) =>
            track.clips
              .filter((clip) => clip.start.flicks >= state.playhead.flicks)
              .map((clip) => clip.id),
          ),
        );
      } else if (action === "clear") {
        state.select(null);
        state.setRange(null);
      } else if (action === "toggleSnapping") state.setSnapping(!state.snapping);
      else if (action === "play") state.setPlaying(!state.playing);
      else if (action === "back" || action === "forward")
        state.seek(
          stepFrame(
            state.playhead,
            (action === "back" ? -1 : 1) * (event.shiftKey ? 5 : 1),
            project,
          ),
        );
      else if (action === "home" || action === "end")
        state.seek(action === "home" ? new Time(0n) : projectDuration(project));
      else if (action === "zoomIn" || action === "zoomOut")
        state.setZoom(state.zoom * (action === "zoomIn" ? 1.5 : 1 / 1.5));
      else if (action === "zoomToFit") fitTimeline();
      else if (["previous", "next", "previousMarker", "nextMarker"].includes(action)) {
        const tracks = [...project.videoTracks, ...project.audioTracks];
        const targeted = tracks.filter((track) => track.targeted);
        const edges = (
          action === "previousMarker" || action === "nextMarker"
            ? project.markers.map((marker) => marker.time)
            : (targeted.length ? targeted : tracks).flatMap((t) =>
                t.clips.flatMap((c) => [c.start.seconds, c.start.seconds + c.duration.seconds]),
              )
        ).sort((a, b) => a - b);
        const next =
          action === "previous" || action === "previousMarker"
            ? edges.filter((t) => t < state.playhead.seconds - 1e-7).at(-1)
            : edges.find((t) => t > state.playhead.seconds + 1e-7);
        if (next != null) state.seek(atFrame(next, project));
      } else if (action === "nudgeLeft" || action === "nudgeRight")
        run(() => {
          if (state.selected.length)
            return session.apply({
              label: "Nudge selection",
              commands: [
                {
                  moveClips: {
                    clipIDs: state.selected,
                    delta:
                      ((action === "nudgeLeft" ? -1 : 1) *
                        (event.shiftKey ? 5 : 1) *
                        project.settings.frameRate.denominator) /
                      project.settings.frameRate.numerator,
                  },
                },
              ],
            });
        });
      else if (action === "markIn")
        state.setRange({
          from: state.playhead.seconds,
          to: Math.max(state.playhead.seconds, state.range?.to ?? state.playhead.seconds),
        });
      else if (action === "markOut")
        state.setRange({
          from: Math.min(state.range?.from ?? 0, state.playhead.seconds),
          to: state.playhead.seconds,
        });
      else if (action === "markClip") {
        const clip = [...project.videoTracks.toReversed(), ...project.audioTracks]
          .filter((track) => track.targeted)
          .flatMap((track) => track.clips)
          .find(
            (candidate) =>
              candidate.start.flicks <= state.playhead.flicks &&
              candidate.start.flicks + candidate.duration.flicks > state.playhead.flicks,
          );
        if (clip)
          state.setRange({
            from: clip.start.seconds,
            to: clip.start.seconds + clip.duration.seconds,
          });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  return {
    split,
    remove,
    link,
    unlink,
    copy,
    paste,
    hasClipboard,
    addMarker,
    addTrack,
    disabled: snapshot.readOnly || snapshot.busy,
  };
}
export type EditActions = ReturnType<typeof useEditActions>;
