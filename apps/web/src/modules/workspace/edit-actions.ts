import { useEffect, useRef } from "react";
import { useEditorSession } from "./editor-session";
import type { Project } from "@sidecut/contracts/project";
import { Time } from "@sidecut/contracts/time";
import { shortcut, protectsEditing } from "./keyboard";
import { copyClips, pasteClips, type ClipClipboard } from "./clipboard";
import { projectDuration, stepFrame, atFrame } from "./timeline-model";

export function selectionWithLinks(project: Project, ids: readonly string[]): string[] {
  const clips = [...project.videoTracks, ...project.audioTracks].flatMap((t) => t.clips);
  const groups = new Set(
    clips.filter((c) => ids.includes(c.id) && c.linkGroup).map((c) => c.linkGroup),
  );
  return clips
    .filter((c) => ids.includes(c.id) || (c.linkGroup && groups.has(c.linkGroup)))
    .map((c) => c.id);
}
export function useEditActions(run: (action: () => unknown) => void) {
  const { session, editor, snapshot } = useEditorSession();
  const clipboard = useRef<ClipClipboard | null>(null);
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
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (protectsEditing(event.target)) return;
      const state = editor.getState(),
        action = shortcut(event, state.keymap);
      if (
        !action ||
        (action === "play" &&
          event.target instanceof HTMLElement &&
          event.target.closest("button,a"))
      )
        return;
      const project = session.getSnapshot().project;
      if (session.getSnapshot().readOnly || session.getSnapshot().busy) return;
      if (
        event.repeat &&
        ["split", "remove", "rippleRemove", "undo", "redo", "copy", "paste"].includes(action)
      )
        return;
      event.preventDefault();
      if (action === "split") split();
      else if (action === "remove" || action === "rippleRemove") remove(action === "rippleRemove");
      else if (action === "undo" || action === "redo") run(() => session[action]());
      else if (action === "copy")
        run(() => {
          clipboard.current = copyClips(project, state.selected);
        });
      else if (action === "paste")
        run(() => {
          if (clipboard.current)
            session.apply({
              label: "Paste clips",
              commands: pasteClips(
                project,
                clipboard.current,
                state.playhead.seconds,
                () => `clip_${crypto.randomUUID()}`,
              ),
            });
        });
      else if (action === "selectAll") {
        state.select(null);
        for (const clip of [...project.videoTracks, ...project.audioTracks].flatMap((t) => t.clips))
          editor.getState().select(clip.id, true);
      } else if (action === "clear") {
        state.select(null);
        state.setRange(null);
      } else if (action === "play") state.setPlaying(!state.playing);
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
      else if (action === "previous" || action === "next") {
        const edges = [
          0,
          ...[...project.videoTracks, ...project.audioTracks].flatMap((t) =>
            t.clips.flatMap((c) => [c.start.seconds, c.start.seconds + c.duration.seconds]),
          ),
        ].sort((a, b) => a - b);
        const next =
          action === "previous"
            ? edges.filter((t) => t < state.playhead.seconds - 1e-7).at(-1)
            : edges.find((t) => t > state.playhead.seconds + 1e-7);
        if (next != null) state.seek(atFrame(next, project));
      } else if (action === "nudgeLeft" || action === "nudgeRight")
        run(() => {
          if (state.selected.length)
            session.apply({
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
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  return { split, remove, link, unlink, disabled: snapshot.readOnly || snapshot.busy };
}
