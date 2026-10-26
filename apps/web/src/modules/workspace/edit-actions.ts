import { useEffect, useRef, useState } from "react";
import { useEditorSession } from "./editor-session";
import type { Project } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import { shortcut, protectsEditing, ownsKey } from "./keyboard";
import { copyClips, pasteClips, type ClipClipboard } from "./clipboard";
import { projectDuration, stepFrame, atFrame } from "./timeline-model";
import { playheadTrim } from "./playhead-trim";
import { toggleClipKeyframes } from "./keyframe-shortcut";
import { rangeEdit } from "./range-edits";
import { diffEdits } from "@sidecut/core/service-edits";
import { defaultTransitionSound } from "./transition-sound-controls";

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
        action = shortcut(event, state.keymap, state.keymapOverrides);
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
          "liftInOut",
          "extractInOut",
          "freezeFrame",
          "toggleKeyframe",
          "layoutFull",
          "layoutPipRight",
          "layoutPipLeft",
          "layoutSplit",
          "nudgeLeftFive",
          "nudgeRightFive",
          "addTransition",
          "markAgentChangesReviewed",
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
          "addComment",
          "addSectionCards",
          "addTransition",
          "freezeFrame",
          "toggleKeyframe",
          "markAgentChangesReviewed",
          "newProject",
          "saveVersion",
        ].includes(action)
      )
        return;
      event.preventDefault();
      if (
        action === "save" ||
        action === "saveVersion" ||
        action === "export" ||
        action === "newProject" ||
        action === "openProject"
      )
        editor.setState({ requestedDialog: action });
      else if (action === "addComment" || action === "addSectionCards")
        editor.setState({ requestedDialog: action === "addComment" ? "comment" : "cards" });
      else if (action === "markAgentChangesReviewed") run(() => session.markReviewed());
      else if (action === "toggleProxy") {
        const useProxies = !state.useProxies;
        editor.setState({ useProxies });
        for (const [id, value] of Object.entries(session.analysis.getSnapshot()))
          if (value.proxy) session.analysis.useProxy(id, useProxies);
      } else if (action === "previousAgentChange" || action === "nextAgentChange")
        run(() => {
          const entries = (diffEdits(session.projectFile(), 0) ?? [])
            .filter((entry) => !["user", "human"].includes(entry.author) && entry.start != null)
            .sort((a, b) => a.start! - b.start!);
          const entry =
            action === "previousAgentChange"
              ? entries.filter((value) => value.start! < state.playhead.seconds - 1e-7).at(-1)
              : entries.find((value) => value.start! > state.playhead.seconds + 1e-7);
          if (entry?.start != null) {
            state.seek(Time.fromSeconds(entry.start));
            state.selectMany(entry.changes.map((change) => change.id));
          }
        });
      else if (action === "addTransition")
        run(() => {
          const tracks = [...project.videoTracks, ...project.audioTracks];
          const track = tracks.find((value) =>
            value.clips.some((clip) => state.selected.includes(clip.id)),
          );
          const clip = track?.clips.find((value) => state.selected.includes(value.id));
          if (!track || !clip) throw new Error("Select a clip before adding a transition.");
          const next = track.clips.find(
            (value) => value.start.flicks === clip.start.flicks + clip.duration.flicks,
          );
          const type = next ? "dissolve" : "fadeToBlack";
          const sound = defaultTransitionSound(project, type);
          return session.apply({
            label: "Add transition",
            commands: [
              {
                addTransition: {
                  trackID: track.id,
                  transition: {
                    type,
                    fromClipID: clip.id,
                    toClipID: next?.id ?? null,
                    duration: Math.min(
                      0.4,
                      clip.duration.seconds / 2,
                      next ? next.duration.seconds / 2 : Infinity,
                    ),
                  },
                  ...(sound == null ? {} : { sound }),
                },
              },
            ],
          });
        });
      else if (
        action === "shuttleReverse" ||
        action === "shuttleForward" ||
        action === "shuttleStop"
      )
        state.shuttle(action === "shuttleStop" ? 0 : action === "shuttleReverse" ? -1 : 1);
      else if (action === "clearInOut") state.setRange(null);
      else if (action === "clearIn") state.setIn(null);
      else if (action === "clearOut") state.setOut(null);
      else if (action === "liftInOut" || action === "extractInOut")
        run(async () => {
          if (!state.range || state.range.to <= state.range.from)
            throw new Error("Set in and out points first (I and O).");
          const range = { start: state.range.from, duration: state.range.to - state.range.from };
          const batch = rangeEdit(
            project,
            state.range.from,
            state.range.to,
            action === "extractInOut",
          );
          if (!batch) return;
          await session.apply(batch);
          if (action === "extractInOut") {
            state.setRange(null);
            state.seek(Time.fromSeconds(range.start));
          }
        });
      else if (action === "freezeFrame")
        run(() => {
          const clips = project.videoTracks
            .flatMap((track) => track.clips)
            .filter(
              (clip) =>
                state.selected.includes(clip.id) &&
                clip.start.seconds <= state.playhead.seconds &&
                clip.start.seconds + clip.duration.seconds > state.playhead.seconds,
            );
          return session.apply({
            label: "Freeze frame",
            commands: clips.map((clip) => ({
              holdFrame: {
                clipID: clip.id,
                range: {
                  start: state.playhead.seconds,
                  duration: clip.start.seconds + clip.duration.seconds - state.playhead.seconds,
                },
              },
            })),
          });
        });
      else if (action === "previousKeyframe" || action === "nextKeyframe") {
        const times = [...project.videoTracks, ...project.audioTracks]
          .flatMap((track) => track.clips)
          .filter((clip) => state.selected.includes(clip.id))
          .flatMap((clip) =>
            Object.values(clip.keyframes).flatMap((frames) =>
              frames.map((frame) => clip.start.seconds + Number(frame.time)),
            ),
          )
          .sort((a, b) => a - b);
        const next =
          action === "previousKeyframe"
            ? times.filter((time) => time < state.playhead.seconds - 1e-7).at(-1)
            : times.find((time) => time > state.playhead.seconds + 1e-7);
        if (next != null) state.seek(Time.fromSeconds(next));
      } else if (action === "toggleKeyframe")
        run(() =>
          session.apply(toggleClipKeyframes(project, state.selected, state.playhead.seconds)),
        );
      else if (
        action === "layoutFull" ||
        action === "layoutPipRight" ||
        action === "layoutPipLeft" ||
        action === "layoutSplit"
      )
        run(() =>
          session.apply({
            label: "Apply layout",
            commands: [
              {
                applyLayout: {
                  clipIDs: state.selected,
                  preset:
                    action === "layoutFull"
                      ? "full"
                      : action === "layoutPipRight"
                        ? "pipRight"
                        : action === "layoutPipLeft"
                          ? "pipLeft"
                          : "split",
                },
              },
            ],
          }),
        );
      else if (action === "toggleLinkedSelection")
        editor.setState({ linkedSelection: !state.linkedSelection });
      else if (action === "toggleRipple") editor.setState({ rippleTrims: !state.rippleTrims });
      else if (action === "toggleTranscriptLane")
        editor.setState({ showTranscript: !state.showTranscript });
      else if (action === "toggleSafeMargins") editor.setState({ safeMargins: !state.safeMargins });
      else if (
        action === "toolSelect" ||
        action === "toolBlade" ||
        action === "toolRippleTrim" ||
        action === "toolRoll" ||
        action === "toolSlip" ||
        action === "toolSlide"
      )
        editor.setState({
          tool:
            action === "toolSelect"
              ? "select"
              : action === "toolBlade"
                ? "blade"
                : action === "toolRippleTrim"
                  ? "ripple"
                  : action === "toolRoll"
                    ? "roll"
                    : action === "toolSlip"
                      ? "slip"
                      : "slide",
        });
      else if (action === "split") split();
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
      else if (
        action === "back" ||
        action === "forward" ||
        action === "backFive" ||
        action === "forwardFive"
      )
        state.seek(
          stepFrame(
            state.playhead,
            (action === "back" || action === "backFive" ? -1 : 1) *
              (event.shiftKey || action.endsWith("Five") ? 5 : 1),
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
      } else if (
        action === "nudgeLeft" ||
        action === "nudgeRight" ||
        action === "nudgeLeftFive" ||
        action === "nudgeRightFive"
      )
        run(() => {
          if (state.selected.length)
            return session.apply({
              label: "Nudge selection",
              commands: [
                {
                  moveClips: {
                    clipIDs: state.selected,
                    delta:
                      ((action === "nudgeLeft" || action === "nudgeLeftFive" ? -1 : 1) *
                        (event.shiftKey || action.endsWith("Five") ? 5 : 1) *
                        project.settings.frameRate.denominator) /
                      project.settings.frameRate.numerator,
                  },
                },
              ],
            });
        });
      else if (action === "markIn") state.setIn(state.playhead.seconds);
      else if (action === "markOut") state.setOut(state.playhead.seconds);
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
