import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiFilmLine,
  RiLayoutLine,
  RiPlayFill,
  RiScissorsCutLine,
  RiVolumeUpLine,
} from "@remixicon/react";
import { Button } from "@sidecut/ui/components/button";
import { Alert, AlertTitle, AlertDescription } from "@sidecut/ui/components/alert";
import { ProjectSettings } from "./project-settings";
import { MediaBin } from "./media-bin";
import { useEditorSession } from "./editor-session";
import { PanelDivider } from "./panel-divider";
import {
  DEFAULT_PANELS,
  DIVIDER_SIZE,
  INSPECTOR_MIN,
  MEDIA_MIN,
  PANEL_STORAGE_KEY,
  TIMELINE_MIN,
  VIEWER_MIN,
  WORKSPACE_MIN,
  fitPanels,
  readPanelSizes,
} from "./panel-sizes";
import type { PanelSizes } from "./panel-sizes";
import "./workspace.css";

export function WorkspaceHome() {
  const { session, snapshot } = useEditorSession();
  const projectPicker = useRef<HTMLInputElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const locked = snapshot.readOnly || snapshot.busy;
  function run(action: () => unknown) {
    setActionError(null);
    void Promise.resolve()
      .then(action)
      .catch((cause) => setActionError(cause instanceof Error ? cause.message : String(cause)));
  }
  const [sizes, setSizes] = useState<PanelSizes>({ ...DEFAULT_PANELS });
  const [dimensions, setDimensions] = useState({ width: 1280, height: 636 });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferenceError, setPreferenceError] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const fitted = fitPanels(sizes, dimensions.width, dimensions.height);
  const { project } = snapshot;
  const tracks = [...project.videoTracks.toReversed(), ...project.audioTracks];
  const frameRate = project.settings.frameRate.numerator / project.settings.frameRate.denominator;

  useEffect(() => {
    try {
      setSizes(readPanelSizes(localStorage.getItem(PANEL_STORAGE_KEY)));
    } catch {
      setPreferenceError(true);
    }
    setPreferencesReady(true);
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry)
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ version: 1, ...sizes }));
      setPreferenceError(false);
    } catch {
      setPreferenceError(true);
    }
  }, [sizes, preferencesReady]);

  function updatePanel(panel: keyof PanelSizes, value: number | null) {
    setSizes((current) => ({ ...current, [panel]: value }));
  }

  const mediaMax = Math.max(
    MEDIA_MIN,
    Math.min(560, dimensions.width - fitted.inspector - VIEWER_MIN - DIVIDER_SIZE * 2),
  );
  const inspectorMax = Math.max(
    INSPECTOR_MIN,
    Math.min(600, dimensions.width - fitted.media - VIEWER_MIN - DIVIDER_SIZE * 2),
  );
  const workspaceMax = Math.max(WORKSPACE_MIN, dimensions.height - TIMELINE_MIN - DIVIDER_SIZE);

  return (
    <main
      className="dark editor-shell bg-background text-foreground"
      aria-label="SideCut video editor"
    >
      <header className="editor-topbar">
        <div className="editor-brand">
          <RiScissorsCutLine aria-hidden="true" />
          <span>SideCut</span>
        </div>
        <div className="editor-project-name">
          <span data-testid="project-name">{project.name}</span>
          <span className="editor-session-label" role="status">
            {snapshot.saveState === "saved"
              ? "Saved in browser"
              : snapshot.saveState === "read-only"
                ? "Read-only"
                : snapshot.saveState === "loading"
                  ? "Opening?"
                  : snapshot.saveState === "saving"
                    ? "Saving?"
                    : "Save failed"}
          </span>
        </div>
        <div className="editor-topbar-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label={snapshot.undoLabel ? `Undo ${snapshot.undoLabel}` : "Undo"}
            disabled={locked || !snapshot.undoLabel}
            onClick={() => run(() => session.undo())}
            title={snapshot.undoLabel ? `Undo ${snapshot.undoLabel}` : "Nothing to undo"}
          >
            <RiArrowGoBackLine aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={snapshot.redoLabel ? `Redo ${snapshot.redoLabel}` : "Redo"}
            disabled={locked || !snapshot.redoLabel}
            onClick={() => run(() => session.redo())}
            title={snapshot.redoLabel ? `Redo ${snapshot.redoLabel}` : "Nothing to redo"}
          >
            <RiArrowGoForwardLine aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSizes({ ...DEFAULT_PANELS })}
            title="Restore standard panel sizes"
          >
            <RiLayoutLine data-icon="inline-start" aria-hidden="true" />
            Reset layout
          </Button>
          <Link to="/diagnostics" className="editor-checks-link">
            Checks
          </Link>
          <Button
            variant="outline"
            size="sm"
            disabled={snapshot.busy || snapshot.saveState === "loading"}
            onClick={() => projectPicker.current?.click()}
          >
            Open project
          </Button>
          <input
            ref={projectPicker}
            type="file"
            accept=".tandem,.json,application/json"
            className="sr-only"
            tabIndex={-1}
            aria-label="Tandem project file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) run(() => session.openProject(file));
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={snapshot.saveState === "loading"}
            onClick={() => run(() => session.downloadProject())}
          >
            Download project
          </Button>
          <Button size="sm" disabled title="Export is not available yet">
            Export
          </Button>
        </div>
      </header>

      {(actionError || snapshot.error) && (
        <Alert variant="destructive" className="editor-notice">
          <AlertTitle>Action needs attention</AlertTitle>
          <AlertDescription>{actionError ?? snapshot.error}</AlertDescription>
          {snapshot.saveState === "error" && (
            <Button size="sm" variant="outline" onClick={() => run(() => session.retrySave())}>
              Retry save
            </Button>
          )}
        </Alert>
      )}
      {snapshot.readOnly && snapshot.saveState === "read-only" && (
        <Alert className="editor-notice">
          <AlertTitle>Another tab is editing this project</AlertTitle>
          <AlertDescription>
            You can review and download this copy. Close the other editing tab to make changes here.
          </AlertDescription>
          <Button
            size="sm"
            variant="outline"
            disabled={snapshot.busy}
            onClick={() => run(() => session.enableEditing())}
          >
            Enable editing
          </Button>
        </Alert>
      )}
      {snapshot.lastChange && (
        <p className="sr-only" role="status">
          {snapshot.lastChange.label}
        </p>
      )}
      <div
        ref={container}
        className="editor-body"
        style={{ gridTemplateRows: `${fitted.workspace}px ${DIVIDER_SIZE}px minmax(0, 1fr)` }}
      >
        <div
          className="editor-workspace"
          style={{
            gridTemplateColumns: `${fitted.media}px ${DIVIDER_SIZE}px minmax(${VIEWER_MIN}px, 1fr) ${DIVIDER_SIZE}px ${fitted.inspector}px`,
          }}
        >
          <MediaBin run={run} />
          <PanelDivider
            label="Media panel width"
            controls="media-panel"
            orientation="vertical"
            value={fitted.media}
            min={MEDIA_MIN}
            max={mediaMax}
            onChange={(value) => updatePanel("media", value)}
            onReset={() => updatePanel("media", DEFAULT_PANELS.media)}
          />
          <section aria-labelledby="viewer-title" className="editor-panel editor-viewer">
            <div className="editor-panel-heading">
              <h2 id="viewer-title">Viewer</h2>
              <span>
                {project.settings.width} × {project.settings.height}
              </span>
            </div>
            <div className="editor-viewer-stage">
              <div
                className="editor-canvas"
                style={{
                  aspectRatio: `${project.settings.width} / ${project.settings.height}`,
                  width: `min(100cqw, ${(100 * project.settings.width) / project.settings.height}cqh)`,
                }}
              >
                <RiFilmLine aria-hidden="true" />
                <p>
                  {tracks.some((track) => track.clips.length)
                    ? "Sequence preview is not available yet"
                    : "Your sequence is empty"}
                </p>
              </div>
            </div>
            <div className="editor-transport">
              <span className="editor-timecode">00:00:00:00</span>
              <Button
                variant="ghost"
                size="icon"
                disabled
                aria-label="Play sequence"
                title="Add media before playing"
              >
                <RiPlayFill aria-hidden="true" />
              </Button>
              <span className="editor-transport-rate">{Number(frameRate.toFixed(3))} fps</span>
            </div>
          </section>
          <PanelDivider
            label="Inspector panel width"
            controls="inspector-panel"
            orientation="vertical"
            value={fitted.inspector}
            min={INSPECTOR_MIN}
            max={inspectorMax}
            reverse
            onChange={(value) => updatePanel("inspector", value)}
            onReset={() => updatePanel("inspector", DEFAULT_PANELS.inspector)}
          />
          <section
            id="inspector-panel"
            aria-labelledby="inspector-title"
            className="editor-panel editor-inspector"
          >
            <div className="editor-panel-heading">
              <h2 id="inspector-title">Inspector</h2>
              <span>Sequence</span>
            </div>
            <div
              className="editor-inspector-content"
              role="region"
              aria-label="Sequence and clip properties"
              tabIndex={0}
            >
              <ProjectSettings key={`${project.id}:${snapshot.revision}`} />
              <div className="editor-selection-hint">
                <RiFilmLine aria-hidden="true" />
                <h3>No clip selected</h3>
                <p>Clip properties will appear here when you select something on the timeline.</p>
              </div>
            </div>
          </section>
        </div>
        <PanelDivider
          label="Viewer and timeline height"
          controls="timeline-panel"
          orientation="horizontal"
          value={fitted.workspace}
          min={WORKSPACE_MIN}
          max={workspaceMax}
          onChange={(value) => updatePanel("workspace", value)}
          onReset={() => updatePanel("workspace", null)}
        />
        <section id="timeline-panel" aria-labelledby="timeline-title" className="editor-timeline">
          <div className="editor-timeline-toolbar">
            <h2 id="timeline-title">Timeline</h2>
            <span>{tracks.length} tracks</span>
            <span className="editor-timecode">00:00:00:00</span>
          </div>
          <div
            className="editor-timeline-scroll"
            role="region"
            aria-label="Timeline tracks"
            tabIndex={0}
          >
            <div className="editor-ruler">
              <div>Track</div>
              <div className="editor-ruler-ticks">
                {[0, 5, 10, 15, 20, 25].map((second) => (
                  <span key={second}>{second}s</span>
                ))}
              </div>
            </div>
            {tracks.map((track, index) => (
              <div key={track.id} className="editor-track" data-kind={track.kind}>
                <div className="editor-track-header">
                  <span className="editor-track-label">
                    {track.kind === "video"
                      ? `V${project.videoTracks.length - index}`
                      : `A${index - project.videoTracks.length + 1}`}
                  </span>
                  {track.kind === "video" ? (
                    <RiFilmLine aria-hidden="true" />
                  ) : (
                    <RiVolumeUpLine aria-hidden="true" />
                  )}
                  <span className="editor-track-name">{track.name}</span>
                  <span className="editor-ripple-mode">{track.rippleMode}</span>
                </div>
                <div className="editor-track-lane">
                  <div className="editor-playhead-line" />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
      <footer className="editor-statusbar">
        <span>
          <span className="editor-status-dot" />
          {snapshot.busy
            ? "Working"
            : snapshot.saveState === "loading"
              ? "Opening"
              : snapshot.readOnly
                ? "Read-only"
                : "Ready"}
        </span>
        <span>Media stays local · Download a project copy for backup</span>
        <span role="status" data-testid="revision">
          Revision {snapshot.revision}
        </span>
        {preferenceError && <span role="alert">Panel sizes could not be saved</span>}
      </footer>
    </main>
  );
}
