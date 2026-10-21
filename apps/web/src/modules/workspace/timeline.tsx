import { useRef, useState, useEffect } from "react";
import {
  RiLockLine,
  RiLockUnlockLine,
  RiVolumeMuteLine,
  RiVolumeUpLine,
  RiArrowUpSLine,
  RiArrowDownSLine,
  RiDeleteBinLine,
} from "@remixicon/react";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { useEditorSession, useEditorView } from "./editor-session";
import { projectDuration, atFrame, stepFrame, timecode } from "./timeline-model";
import { ClipBlock } from "./clip-block";
import { EditToolbar } from "./edit-toolbar";
import { placeSource, MEDIA_DRAG_TYPE } from "./placement";

const HEADER = 320;

export function Timeline({ run }: { run: (action: () => unknown) => void }) {
  const { session, snapshot, editor } = useEditorSession();
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
                  <div className="editor-track-heading">
                    <span className="editor-track-label">
                      {track.kind === "video" ? "V" : "A"}
                      {index + 1}
                    </span>
                    <Input
                      key={`${track.id}:${track.name}`}
                      aria-label={`Rename track ${track.name}`}
                      defaultValue={track.name}
                      disabled={disabled}
                      onBlur={(event) => {
                        if (event.target.value !== track.name)
                          patch(track.id, { name: event.target.value });
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                    />
                  </div>
                  <div className="editor-track-controls">
                    <Button
                      size="icon-xs"
                      variant={track.locked ? "secondary" : "ghost"}
                      disabled={disabled}
                      aria-label={`Lock track ${track.name}`}
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
                      size="xs"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`Ripple mode ${track.name}: ${track.rippleMode}`}
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
                      {track.rippleMode}
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      disabled={disabled || index + step < 0 || index + step >= list.length}
                      aria-label={`Move track ${track.name} up`}
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
                  </div>
                </div>
                <div
                  className="editor-track-lane"
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
                      const clipID = placeSource(session, id, track.id, time);
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
