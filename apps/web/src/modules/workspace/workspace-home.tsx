import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiFilmLine,
  RiFolderVideoLine,
  RiLayoutLine,
  RiPlayFill,
  RiScissorsCutLine,
  RiVolumeUpLine,
} from "@remixicon/react";
import { Button } from "@sidecut/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@sidecut/ui/components/empty";
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
          <span className="editor-session-label">Session only</span>
        </div>
        <div className="editor-topbar-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label={snapshot.undoLabel ? `Undo ${snapshot.undoLabel}` : "Undo"}
            disabled={!snapshot.undoLabel}
            onClick={() => session.undo()}
            title={snapshot.undoLabel ? `Undo ${snapshot.undoLabel}` : "Nothing to undo"}
          >
            <RiArrowGoBackLine aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={snapshot.redoLabel ? `Redo ${snapshot.redoLabel}` : "Redo"}
            disabled={!snapshot.redoLabel}
            onClick={() => session.redo()}
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
          <Button size="sm" disabled title="Export is not available yet">
            Export
          </Button>
        </div>
      </header>

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
          <section
            id="media-panel"
            aria-labelledby="media-title"
            className="editor-panel editor-media-panel"
          >
            <div className="editor-panel-heading">
              <h1 id="media-title">Project media</h1>
              <span>{project.media.length} files</span>
            </div>
            <div
              className="editor-panel-content"
              role="region"
              aria-label="Project media contents"
              tabIndex={0}
            >
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <RiFolderVideoLine aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No media yet</EmptyTitle>
                  <EmptyDescription>
                    Your local video, audio, and images will appear here. Import is not available
                    yet.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
            <div className="editor-panel-footnote">
              <RiFolderVideoLine aria-hidden="true" />
              Files stay on your device
            </div>
          </section>
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
                <p>Your sequence is empty</p>
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
              <div className="editor-inspector-section">
                <h3>Sequence properties</h3>
                <dl>
                  <div>
                    <dt>Canvas</dt>
                    <dd>
                      {project.settings.width} × {project.settings.height}
                    </dd>
                  </div>
                  <div>
                    <dt>Frame rate</dt>
                    <dd>{Number(frameRate.toFixed(3))} fps</dd>
                  </div>
                  <div>
                    <dt>Audio</dt>
                    <dd>{project.settings.sampleRate / 1000} kHz</dd>
                  </div>
                  <div>
                    <dt>Color</dt>
                    <dd>
                      {project.settings.colorSpace === "rec709"
                        ? "Rec.709"
                        : project.settings.colorSpace}
                    </dd>
                  </div>
                </dl>
              </div>
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
          Ready
        </span>
        <span>Project changes are kept for this session only</span>
        <span role="status" data-testid="revision">
          Revision {snapshot.revision}
        </span>
        {preferenceError && <span role="alert">Panel sizes could not be saved</span>}
      </footer>
    </main>
  );
}
