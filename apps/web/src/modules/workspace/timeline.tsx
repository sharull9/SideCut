import { TransitionBlock } from "./transition-controls";
import { AdjustmentDialog } from "./adjustment-dialog";
import { useRef, useState, useEffect, useMemo, useSyncExternalStore } from "react";
import { placeWords } from "@sidecut/core/transcript";
import { Time } from "@sidecut/contracts/time";
import {
  RiLockLine,
  RiLockUnlockLine,
  RiVolumeMuteLine,
  RiVolumeUpLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiDeleteBinLine,
  RiScissorsCutLine,
  RiLinksLine,
  RiLinkUnlinkM,
} from "@remixicon/react";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { useEditorSession, useEditorView } from "./editor-session";
import { projectDuration, atFrame, stepFrame, timecode } from "./timeline-model";
import { ClipBlock } from "./clip-block";
import { EditToolbar } from "./edit-toolbar";
import { placeSource, MEDIA_DRAG_TYPE } from "./placement";

const HEADER = 248;
const RIPPLE_HELP = {
  cut: "Ripple edits split and shift clips on this track",
  follow: "Ripple edits shift clips on this track without splitting them",
  off: "Ripple edits leave this track in place",
} as const;

// The name reads as text; double-click (or Enter/F2 when focused) switches to an input.
function TrackName({
  name,
  disabled,
  onRename,
}: {
  name: string;
  disabled: boolean;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <Input
        autoFocus
        className="editor-track-name"
        aria-label={`Rename track ${name}`}
        defaultValue={name}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => {
          setEditing(false);
          const next = event.target.value.trim();
          if (next && next !== name) onRename(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.currentTarget.value = name;
            event.currentTarget.blur();
          }
        }}
      />
    );
  return (
    <button
      type="button"
      className="editor-track-name"
      disabled={disabled}
      aria-label={`Rename track ${name}`}
      title="Double-click to rename"
      onDoubleClick={() => setEditing(true)}
      onClick={(event) => {
        // detail is 0 for keyboard activation; the mouse renames on double-click only.
        if (event.detail === 0) setEditing(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "F2") setEditing(true);
      }}
    >
      {name}
    </button>
  );
}

export function Timeline({ run }: { run: (action: () => unknown) => void }) {
  const { session, snapshot, editor } = useEditorSession();
  const analysis = useSyncExternalStore(
    session.analysis.subscribe,
    session.analysis.getSnapshot,
    session.analysis.getSnapshot,
  );
  const wordsByTrack = useMemo(
    () =>
      new Map(
        [...snapshot.project.videoTracks, ...snapshot.project.audioTracks].map((track) => [
          track.id,
          snapshot.project.media
            .flatMap((media) => {
              const transcript = analysis[media.id]?.transcript;
              return transcript
                ? placeWords(
                    transcript,
                    track.clips.filter(
                      (clip) =>
                        clip.content.media &&
                        typeof clip.content.media === "object" &&
                        "mediaID" in clip.content.media &&
                        clip.content.media.mediaID === media.id,
                    ),
                  )
                : [];
            })
            .sort((a, b) => a.start - b.start),
        ]),
      ),
    [snapshot.project, analysis],
  );
  const playhead = useEditorView((state) => state.playhead);
  const zoom = useEditorView((state) => state.zoom);
  const selected = useEditorView((state) => state.selected);
  const scroll = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState(960);
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const project = snapshot.project;
  const tracks = [...project.videoTracks.toReversed(), ...project.audioTracks];
  const duration = projectDuration(project).seconds;
  const width = Math.min(2_000_000, Math.max(viewport - HEADER, 600, (duration + 5) * zoom));
  const tickStep =
    [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600, 1800, 3600].find(
      (step) => step * zoom >= 70,
    ) ?? 3600;
  const ticks = Array.from(
    { length: Math.min(500, Math.ceil(width / zoom / tickStep)) },
    (_, index) => index * tickStep,
  );
  const disabled = snapshot.readOnly || snapshot.busy;
  const patch = (trackID: string, changes: Record<string, unknown>) =>
    run(() =>
      session.apply({
        label: "Update track",
        commands: [{ updateTrack: { trackID, patch: changes } }],
      }),
    );

  return (
    <section id="timeline-panel" aria-labelledby="timeline-title" className="editor-timeline">
      <div className="editor-timeline-toolbar">
        <h2 id="timeline-title">Timeline</h2>
        <AdjustmentDialog />
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled}
          onClick={() =>
            run(() =>
              session.apply({
                label: "Add video track",
                commands: [{ addTrack: { kind: "video" } }],
              }),
            )
          }
        >
          + Video
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={disabled}
          onClick={() =>
            run(() =>
              session.apply({
                label: "Add audio track",
                commands: [{ addTrack: { kind: "audio" } }],
              }),
            )
          }
        >
          + Audio
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Zoom out timeline"
          onClick={() => editor.getState().setZoom(zoom / 1.5)}
        >
          −
        </Button>
        <span className="editor-zoom-label">{Number(zoom.toFixed(1))} px/s</span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Zoom in timeline"
          onClick={() => editor.getState().setZoom(zoom * 1.5)}
        >
          +
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            editor
              .getState()
              .setZoom(
                ((scroll.current?.clientWidth ?? 960) - HEADER - 32) / Math.max(5, duration + 1),
              );
            if (scroll.current) scroll.current.scrollLeft = 0;
          }}
        >
          Fit
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={!selected.length}
          onClick={() => editor.getState().select(null)}
        >
          Clear selection
        </Button>
        <span className="editor-timecode" data-testid="timeline-timecode">
          {timecode(playhead, project)}
        </span>
      </div>
      <EditToolbar run={run} />
      <div
        ref={scroll}
        className="editor-timeline-scroll"
        role="region"
        aria-label="Timeline tracks"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Escape") editor.getState().select(null);
        }}
      >
        <div className="editor-timeline-inner" style={{ width: width + HEADER }}>
          <div className="editor-ruler" style={{ gridTemplateColumns: `${HEADER}px ${width}px` }}>
            <div>Track</div>
            <div
              className="editor-ruler-surface"
              role="slider"
              aria-label="Timeline playhead"
              aria-valuemin={0}
              aria-valuemax={Math.max(duration, playhead.seconds)}
              aria-valuenow={playhead.seconds}
              aria-valuetext={timecode(playhead, project)}
              tabIndex={0}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                const left = event.currentTarget.getBoundingClientRect().left;
                editor.getState().seek(atFrame((event.clientX - left) / zoom, project));
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  const left = event.currentTarget.getBoundingClientRect().left;
                  editor.getState().seek(atFrame((event.clientX - left) / zoom, project));
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Home") {
                  event.preventDefault();
                  editor.getState().seek(atFrame(0, project));
                }
                if (event.key === "End") {
                  event.preventDefault();
                  editor.getState().seek(projectDuration(project));
                }
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  editor
                    .getState()
                    .seek(
                      stepFrame(
                        editor.getState().playhead,
                        event.key === "ArrowLeft" ? -1 : 1,
                        project,
                      ),
                    );
                }
              }}
            >
              {ticks.map((second) => (
                <span key={second} style={{ left: second * zoom }}>
                  {second}s
                </span>
              ))}
              <div className="editor-playhead-head" style={{ left: playhead.seconds * zoom }} />
            </div>
          </div>
          {tracks.map((track) => {
            const list = track.kind === "video" ? project.videoTracks : project.audioTracks;
            const index = list.findIndex((item) => item.id === track.id);
            const step = track.kind === "video" ? 1 : -1;
            return (
              <div
                key={track.id}
                className="editor-track"
                data-kind={track.kind}
                style={{ gridTemplateColumns: `${HEADER}px ${width}px` }}
              >
                <div className="editor-track-header">
                  <span className="editor-track-label">
                    {track.kind === "video" ? "V" : "A"}
                    {index + 1}
                  </span>
                  <TrackName
                    name={track.name}
                    disabled={disabled}
                    onRename={(name) => patch(track.id, { name })}
                  />
                  <div className="editor-track-controls">
                    <Button
                      size="icon-xs"
                      variant={track.locked ? "secondary" : "ghost"}
                      disabled={disabled}
                      aria-label={`Lock track ${track.name}`}
                      title={track.locked ? "Unlock track" : "Lock track"}
                      aria-pressed={track.locked}
                      onClick={() => patch(track.id, { locked: !track.locked })}
                    >
                      {track.locked ? (
                        <RiLockLine aria-hidden="true" />
                      ) : (
                        <RiLockUnlockLine aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant={track.muted ? "secondary" : "ghost"}
                      disabled={disabled}
                      aria-label={`Mute track ${track.name}`}
                      title={track.muted ? "Unmute track" : "Mute track"}
                      aria-pressed={track.muted}
                      onClick={() => patch(track.id, { muted: !track.muted })}
                    >
                      {track.muted ? (
                        <RiVolumeMuteLine aria-hidden="true" />
                      ) : (
                        <RiVolumeUpLine aria-hidden="true" />
                      )}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`Ripple mode ${track.name}: ${track.rippleMode}`}
                      title={`${RIPPLE_HELP[track.rippleMode]}. Click to change.`}
                      onClick={() =>
                        patch(track.id, {
                          rippleMode:
                            track.rippleMode === "cut"
                              ? "follow"
                              : track.rippleMode === "follow"
                                ? "off"
                                : "cut",
                        })
                      }
                    >
                      {track.rippleMode === "cut" ? (
                        <RiScissorsCutLine aria-hidden="true" />
                      ) : track.rippleMode === "follow" ? (
                        <RiLinksLine aria-hidden="true" />
                      ) : (
                        <RiLinkUnlinkM aria-hidden="true" />
                      )}
                    </Button>
                    <span className="editor-track-extra">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        disabled={disabled || index + step < 0 || index + step >= list.length}
                        aria-label={`Move track ${track.name} up`}
                        title="Move track up"
                        onClick={() =>
                          run(() =>
                            session.apply({
                              label: "Move track",
                              commands: [{ moveTrack: { trackID: track.id, index: index + step } }],
                            }),
                          )
                        }
                      >
                        <RiArrowUpSLine aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        disabled={disabled || index - step < 0 || index - step >= list.length}
                        aria-label={`Move track ${track.name} down`}
                        title="Move track down"
                        onClick={() =>
                          run(() =>
                            session.apply({
                              label: "Move track",
                              commands: [{ moveTrack: { trackID: track.id, index: index - step } }],
                            }),
                          )
                        }
                      >
                        <RiArrowDownSLine aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        disabled={disabled || track.locked}
                        aria-label={`Remove track ${track.name}`}
                        title="Remove track and its clips; Undo restores them"
                        onClick={() =>
                          run(() =>
                            session.apply({
                              label: `Remove ${track.name}`,
                              commands: [{ removeTrack: { trackID: track.id } }],
                            }),
                          )
                        }
                      >
                        <RiDeleteBinLine aria-hidden="true" />
                      </Button>
                    </span>
                  </div>
                </div>
                <div
                  className="editor-track-lane"
                  data-has-words={Boolean(wordsByTrack.get(track.id)?.length)}
                  style={{ backgroundSize: `${tickStep * zoom}px 100%` }}
                  data-track-id={track.id}
                  aria-label={`${track.name} clips`}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes(MEDIA_DRAG_TYPE)) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = disabled || track.locked ? "none" : "copy";
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (disabled || track.locked) return;
                    const id = event.dataTransfer.getData(MEDIA_DRAG_TYPE);
                    const time = atFrame(
                      (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom,
                      project,
                    );
                    run(() => {
                      const clipID = placeSource(
                        session,
                        id,
                        track.id,
                        time,
                        event.shiftKey ? "insert" : "place",
                      );
                      editor.getState().select(clipID);
                    });
                  }}
                  onClick={(event) => {
                    if (event.target === event.currentTarget) {
                      editor.getState().select(null);
                      editor
                        .getState()
                        .seek(
                          atFrame(
                            (event.clientX - event.currentTarget.getBoundingClientRect().left) /
                              zoom,
                            project,
                          ),
                        );
                    }
                  }}
                >
                  {track.clips.map((clip) => (
                    <ClipBlock
                      key={clip.id}
                      clip={clip}
                      track={track}
                      zoom={zoom}
                      selected={selected}
                      run={run}
                    />
                  ))}
                  {track.transitions.map((transition) => (
                    <TransitionBlock
                      key={String(transition.id)}
                      track={track}
                      transition={transition}
                      zoom={zoom}
                      run={run}
                    />
                  ))}
                  <div
                    className="editor-transcript-lane"
                    aria-label={`${track.name} transcript words`}
                  >
                    {wordsByTrack.get(track.id)?.map((word) => (
                      <button
                        type="button"
                        key={`${word.clipID}:${word.index}`}
                        style={{
                          left: word.start * zoom,
                          width: Math.max(2, (word.end - word.start) * zoom),
                        }}
                        title={`${word.text} · ${word.start.toFixed(3)} s`}
                        aria-label={`Seek to ${word.text} at ${word.start.toFixed(3)} seconds`}
                        onClick={(event) => {
                          event.stopPropagation();
                          editor.getState().setPlaying(false);
                          editor.getState().seek(Time.fromSeconds(word.start));
                        }}
                      >
                        {word.text}
                      </button>
                    ))}
                  </div>
                  <div className="editor-playhead-line" style={{ left: playhead.seconds * zoom }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
