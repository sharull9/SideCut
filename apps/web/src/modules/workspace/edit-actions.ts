import { useEffect } from "react";
import { useEditorSession } from "./editor-session";
import type { Project } from "@sidecut/contracts/project";

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
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')
      )
        return;
      if (session.getSnapshot().readOnly || session.getSnapshot().busy) return;
      if (
        !event.altKey &&
        !event.shiftKey &&
        (event.ctrlKey || event.metaKey) &&
        ["k", "b"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        split();
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        remove(event.shiftKey);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  return { split, remove, link, unlink, disabled: snapshot.readOnly || snapshot.busy };
}
