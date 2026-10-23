import { useEffect, useRef, useState } from "react";
import { RiPlayFill, RiPauseFill, RiSkipBackLine, RiSkipForwardLine } from "@remixicon/react";
import { Button } from "@sidecut/ui/components/button";
import { Time } from "@sidecut/contracts/time";
import { useEditorSession, useEditorView } from "./editor-session";
import { SourcePreview } from "./source-preview";
import { JobStatus } from "./job-status";
import { timecode, stepFrame, projectDuration } from "./timeline-model";

export function Viewer() {
  const { session, snapshot, editor } = useEditorSession();
  const playhead = useEditorView((state) => state.playhead),
    playing = useEditorView((state) => state.playing);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [meter, setMeter] = useState<{ peakDB: number; rmsDB: number } | null>(null);
  const { project } = snapshot;
  useEffect(() => {
    if (!canvas.current) return;
    const preview = new SourcePreview(
      canvas.current,
      session,
      (time) => editor.setState({ playhead: Time.fromSeconds(time) }),
      () => editor.getState().setPlaying(false),
      setError,
      setMeter,
    );
    let current = session.getSnapshot().project;
    let availability = session.getSnapshot().mediaAvailability;
    const synchronize = () => {
      const next = session.getSnapshot().project;
      if (next.id !== current.id) editor.getState().reset();
      preview.update(next);
      const end = projectDuration(next);
      const clips = new Set(
        [...next.videoTracks, ...next.audioTracks].flatMap((track) =>
          track.clips.map((clip) => clip.id),
        ),
      );
      editor.setState((state) => ({
        selected: state.selected.filter((id) => clips.has(id)),
        playhead: state.playhead.flicks > end.flicks ? end : state.playhead,
      }));
      current = next;
      preview.seek(editor.getState().playhead.seconds);
    };
    synchronize();
    let proxySelection = "";
    const unsubscribeAnalysis = session.analysis.subscribe(() => {
      const selection = Object.entries(session.analysis.getSnapshot())
        .filter(([, state]) => state.proxyEnabled)
        .map(([id]) => id)
        .sort()
        .join(",");
      if (selection === proxySelection) return;
      proxySelection = selection;
      editor.getState().setPlaying(false);
      preview.release();
      preview.seek(editor.getState().playhead.seconds);
    });
    const unsubscribeSession = session.subscribe(() => {
      if (session.getSnapshot().project !== current) synchronize();
      if (session.getSnapshot().mediaAvailability !== availability) {
        availability = session.getSnapshot().mediaAvailability;
        if (!editor.getState().playing) preview.seek(editor.getState().playhead.seconds);
      }
      if (session.getSnapshot().readOnly && session.getSnapshot().saveState !== "read-only") {
        editor.getState().setPlaying(false);
        preview.release();
      }
    });
    const unsubscribeView = editor.subscribe((next, previous) => {
      if (next.seekVersion !== previous.seekVersion) {
        if (
          next.playing &&
          next.playhead.flicks < projectDuration(session.getSnapshot().project).flicks
        )
          void preview.play(next.playhead.seconds);
        else {
          preview.seek(next.playhead.seconds);
          if (next.playing) editor.getState().setPlaying(false);
        }
      } else if (next.playing !== previous.playing) {
        if (next.playing) void preview.play(next.playhead.seconds);
        else preview.pause();
      }
    });
    const visibility = () => {
      if (document.hidden) editor.getState().setPlaying(false);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      unsubscribeView();
      unsubscribeSession();
      unsubscribeAnalysis();
      document.removeEventListener("visibilitychange", visibility);
      preview.close();
      editor.getState().setPlaying(false);
    };
  }, [session, editor]);
  const step = (delta: number) => {
    editor.getState().setPlaying(false);
    editor.getState().seek(stepFrame(editor.getState().playhead, delta, project));
  };
  return (
    <section aria-labelledby="viewer-title" className="editor-panel editor-viewer">
      <div className="editor-panel-heading">
        <h2 id="viewer-title">Viewer</h2>
        <span>
          Source preview · {project.settings.width} × {project.settings.height}
        </span>
      </div>
      <div className="editor-viewer-stage">
        <JobStatus />
        {meter && (
          <div
            className="editor-mix-meter"
            aria-label="Preview mix levels"
            role={meter.peakDB > 0 ? "alert" : undefined}
          >
            Peak {Number.isFinite(meter.peakDB) ? meter.peakDB.toFixed(1) : "−∞"} dBFS · RMS{" "}
            {Number.isFinite(meter.rmsDB) ? meter.rmsDB.toFixed(1) : "−∞"} dBFS{" "}
            {meter.peakDB > 0 && "· Clipping: lower clip gain or add a limiter"}
          </div>
        )}
        <div
          className="editor-canvas"
          style={{
            aspectRatio: `${project.settings.width}/${project.settings.height}`,
            width: `min(100cqw,${(100 * project.settings.width) / project.settings.height}cqh)`,
          }}
        >
          <canvas ref={canvas} aria-label="Sequence picture preview" data-testid="source-preview" />
          {error && (
            <p role="alert" className="editor-preview-error">
              {error}
            </p>
          )}
          {projectDuration(project).flicks === 0n && (
            <p className="editor-preview-placeholder">
              {snapshot.unsupportedJSON
                ? "Preview unavailable for this project format"
                : "Drop a source on a timeline track"}
            </p>
          )}
        </div>
      </div>
      <div className="editor-transport">
        <span className="editor-timecode" data-testid="viewer-timecode">
          {timecode(playhead, project)}
        </span>
        <div className="editor-transport-buttons">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous frame"
            onClick={() => step(-1)}
          >
            <RiSkipBackLine aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={playing ? "Pause sequence" : "Play sequence"}
            disabled={projectDuration(project).flicks === 0n || snapshot.saveState === "loading"}
            onClick={() => editor.getState().setPlaying(!playing)}
          >
            {playing ? <RiPauseFill aria-hidden="true" /> : <RiPlayFill aria-hidden="true" />}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next frame" onClick={() => step(1)}>
            <RiSkipForwardLine aria-hidden="true" />
          </Button>
        </div>
        <span className="editor-transport-rate">
          {Number(
            (project.settings.frameRate.numerator / project.settings.frameRate.denominator).toFixed(
              3,
            ),
          )}{" "}
          fps
        </span>
      </div>
    </section>
  );
}
