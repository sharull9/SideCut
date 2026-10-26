import {
  openPreferences,
  readPreference,
  writePreference,
} from "@sidecut/platform-browser/preferences";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiLayoutLine,
  RiScissorsCutLine,
  RiContractLeftLine,
  RiContractRightLine,
  RiFolderVideoLine,
  RiEqualizerLine,
  RiFolderOpenLine,
  RiFolderReceivedLine,
  RiDownload2Line,
  RiArchiveLine,
  RiPulseLine,
  RiCheckDoubleLine,
} from "@remixicon/react";
import { Button } from "@sidecut/ui/components/button";
import { Alert, AlertTitle, AlertDescription } from "@sidecut/ui/components/alert";
import { Tip, TooltipProvider } from "@sidecut/ui/components/tooltip";
import { ExportDialog } from "./export-dialog";
import { Timeline } from "./timeline";
import { Viewer } from "./viewer";
import { ClipInspector } from "./clip-inspector";
import { SidePanel } from "./side-panel";
import { useEditorSession, useEditorView } from "./editor-session";
import { KEYMAP_STORAGE_KEY } from "./editor-view";
import { PanelDivider } from "./panel-divider";
import { protectsEditing, workspaceShortcut } from "./keyboard";
import {
  DEFAULT_PANELS,
  DIVIDER_SIZE,
  INSPECTOR_MIN,
  MEDIA_MIN,
  PANEL_STORAGE_KEY,
  SIDE_TAB_KEY,
  TIMELINE_MIN,
  VIEWER_MIN,
  WORKSPACE_MIN,
  fitPanels,
  readPanelSizes,
  readSideTab,
} from "./panel-sizes";
import type { PanelSizes, SideTab } from "./panel-sizes";
import "./workspace.css";
import "./side-panels.css";

function PanelRail({
  id,
  label,
  icon,
  text,
  onShow,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  text: string;
  onShow: () => void;
}) {
  return (
    <div className="editor-panel-rail">
      <button id={id} type="button" aria-label={label} title={label} onClick={onShow}>
        {icon}
        <span aria-hidden="true">{text}</span>
      </button>
    </div>
  );
}

export function WorkspaceHome() {
  const { session, snapshot, editor } = useEditorSession();
  const keymap = useEditorView((state) => state.keymap);
  const projectPicker = useRef<HTMLInputElement>(null);
  const filmoraPicker = useRef<HTMLInputElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const locked = snapshot.readOnly || snapshot.busy;
  function run(action: () => unknown) {
    setActionError(null);
    void Promise.resolve()
      .then(action)
      .catch((cause) => setActionError(cause instanceof Error ? cause.message : String(cause)));
  }
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (protectsEditing(event.target)) return;
      const action = workspaceShortcut(event);
      if (!action) return;
      event.preventDefault();
      if (event.repeat || snapshot.saveState === "loading") return;
      if (action === "save") {
        if (!locked) run(() => session.retrySave());
      } else if (action === "open") {
        if (!snapshot.busy) projectPicker.current?.click();
      } else setExportOpen(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const [sideTab, setSideTab] = useState<SideTab>("media");
  const [sizes, setSizes] = useState<PanelSizes>({ ...DEFAULT_PANELS });
  const [dimensions, setDimensions] = useState({ width: 1280, height: 636 });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferenceError, setPreferenceError] = useState(false);
  const [keymapError, setKeymapError] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const previousWidth = useRef(1280);
  const fitted = fitPanels(sizes, dimensions.width, dimensions.height);
  const { project } = snapshot;
  useEffect(() => {
    const width = dimensions.width;
    if (width < 1000 && previousWidth.current >= 1000)
      setSizes((current) => ({ ...current, inspectorHidden: true }));
    if (width < 760 && previousWidth.current >= 760)
      setSizes((current) => ({ ...current, mediaHidden: true }));
    previousWidth.current = width;
  }, [dimensions.width]);

  useEffect(() => {
    let active = true;
    void openPreferences()
      .then(() => {
        if (!active) return;
        setSizes(readPanelSizes(readPreference(PANEL_STORAGE_KEY)));
        setSideTab(readSideTab(readPreference(SIDE_TAB_KEY)));
        editor
          .getState()
          .setKeymap(readPreference(KEYMAP_STORAGE_KEY) === "minimal" ? "minimal" : "premiere");
        setPreferencesReady(true);
      })
      .catch(() => {
        if (active) setPreferenceError(true);
      });
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry)
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [editor]);

  useEffect(() => {
    if (!preferencesReady) return;
    void writePreference(PANEL_STORAGE_KEY, JSON.stringify({ version: 1, ...sizes }))
      .then(() => setPreferenceError(false))
      .catch(() => setPreferenceError(true));
  }, [sizes, preferencesReady]);

  useEffect(() => {
    if (preferencesReady) void writePreference(SIDE_TAB_KEY, sideTab).catch(() => {});
  }, [sideTab, preferencesReady]);
  useEffect(() => {
    if (!preferencesReady) return;
    void writePreference(KEYMAP_STORAGE_KEY, keymap)
      .then(() => setKeymapError(false))
      .catch(() => setKeymapError(true));
  }, [keymap, preferencesReady]);

  function updatePanel<K extends keyof PanelSizes>(panel: K, value: PanelSizes[K]) {
    setSizes((current) => ({ ...current, [panel]: value }));
  }
  // Hiding moves focus to the rail's show button; showing moves it to the panel's hide button.
  function setPanelHidden(panel: "media" | "inspector", hidden: boolean) {
    if (!hidden && dimensions.width < 760)
      updatePanel(panel === "media" ? "inspectorHidden" : "mediaHidden", true);
    updatePanel(panel === "media" ? "mediaHidden" : "inspectorHidden", hidden);
    requestAnimationFrame(() =>
      document.getElementById(`${panel}-${hidden ? "show" : "hide"}`)?.focus(),
    );
  }

  const mediaMax = Math.max(
    MEDIA_MIN,
    Math.min(560, dimensions.width - fitted.inspector - VIEWER_MIN - DIVIDER_SIZE * 2),
  );
  const inspectorMax = Math.max(
    INSPECTOR_MIN,
    Math.min(600, dimensions.width - fitted.media - VIEWER_MIN - DIVIDER_SIZE * 2),
  );
  const columns = [
    `${fitted.media}px`,
    ...(sizes.mediaHidden ? [] : [`${DIVIDER_SIZE}px`]),
    `minmax(${dimensions.width < 1000 ? 180 : VIEWER_MIN}px, 1fr)`,
    ...(sizes.inspectorHidden ? [] : [`${DIVIDER_SIZE}px`]),
    `${fitted.inspector}px`,
  ].join(" ");
  const workspaceMax = Math.max(WORKSPACE_MIN, dimensions.height - TIMELINE_MIN - DIVIDER_SIZE);

  return (
    <TooltipProvider>
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
            <span className="editor-session-label" role="status" data-state={snapshot.saveState}>
              {snapshot.saveState === "saved"
                ? session.native
                  ? "Saved on this device"
                  : "Saved in browser"
                : snapshot.saveState === "read-only"
                  ? "Read-only"
                  : snapshot.saveState === "loading"
                    ? "Opening..."
                    : snapshot.saveState === "saving"
                      ? "Saving..."
                      : "Save failed"}
            </span>
          </div>
          <div className="editor-topbar-actions">
            <div className="editor-toolbar-group">
              <Tip
                label={snapshot.undoLabel ? `Undo ${snapshot.undoLabel}` : "Nothing to undo"}
                shortcut="Ctrl+Z"
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={snapshot.undoLabel ? `Undo ${snapshot.undoLabel}` : "Undo"}
                  disabled={locked || !snapshot.undoLabel}
                  onClick={() => run(() => session.undo())}
                >
                  <RiArrowGoBackLine aria-hidden="true" />
                </Button>
              </Tip>
              <Tip
                label={snapshot.redoLabel ? `Redo ${snapshot.redoLabel}` : "Nothing to redo"}
                shortcut="Ctrl+Shift+Z"
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={snapshot.redoLabel ? `Redo ${snapshot.redoLabel}` : "Redo"}
                  disabled={locked || !snapshot.redoLabel}
                  onClick={() => run(() => session.redo())}
                >
                  <RiArrowGoForwardLine aria-hidden="true" />
                </Button>
              </Tip>
            </div>
            <div className="editor-toolbar-group">
              <Tip label="Reset layout">
                <Button
                  variant="ghost"
                  size="sm"
                  className="editor-topbar-collapse"
                  onClick={() => setSizes({ ...DEFAULT_PANELS })}
                >
                  <RiLayoutLine data-icon="inline-start" aria-hidden="true" />
                  <span className="editor-button-label">Reset layout</span>
                </Button>
              </Tip>
              <Tip label="Checks">
                <Link to="/diagnostics" className="editor-checks-link editor-topbar-collapse">
                  <RiPulseLine aria-hidden="true" />
                  <span className="editor-button-label">Checks</span>
                </Link>
              </Tip>
            </div>
            <div className="editor-toolbar-group">
              <Tip label="Open project">
                <Button
                  variant="ghost"
                  size="sm"
                  className="editor-topbar-collapse"
                  disabled={snapshot.busy || snapshot.saveState === "loading"}
                  onClick={() => projectPicker.current?.click()}
                >
                  <RiFolderOpenLine data-icon="inline-start" aria-hidden="true" />
                  <span className="editor-button-label">Open project</span>
                </Button>
              </Tip>
              <Tip label="Filmora folder">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={snapshot.busy || snapshot.saveState === "loading"}
                  className="editor-topbar-collapse"
                  onClick={() => filmoraPicker.current?.click()}
                >
                  <RiFolderReceivedLine data-icon="inline-start" aria-hidden="true" />
                  <span className="editor-button-label">Filmora folder</span>
                </Button>
              </Tip>
              <input
                ref={filmoraPicker}
                type="file"
                multiple
                {...{ webkitdirectory: "" }}
                className="sr-only"
                tabIndex={-1}
                aria-label="Filmora project folder"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (files.length) run(() => session.openFilmoraFolder(files));
                }}
              />
              <input
                ref={projectPicker}
                type="file"
                accept=".tandem,.json,.sidecut,.wfp,application/json"
                className="sr-only"
                tabIndex={-1}
                aria-label="Project, archive, EDL recipe, or Filmora file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) run(() => session.openProject(file));
                }}
              />
              <Tip label="Download project">
                <Button
                  variant="ghost"
                  size="sm"
                  className="editor-topbar-collapse"
                  disabled={snapshot.saveState === "loading"}
                  onClick={() => run(() => session.downloadProject())}
                >
                  <RiDownload2Line data-icon="inline-start" aria-hidden="true" />
                  <span className="editor-button-label">Download project</span>
                </Button>
              </Tip>
              <Tip label="Archive project">
                <Button
                  variant="ghost"
                  size="sm"
                  className="editor-topbar-collapse"
                  disabled={locked}
                  onClick={() => run(() => session.downloadArchive())}
                >
                  <RiArchiveLine data-icon="inline-start" aria-hidden="true" />
                  <span className="editor-button-label">Archive project</span>
                </Button>
              </Tip>
            </div>
            <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
          </div>
        </header>

        {(actionError || snapshot.error) && (
          <Alert variant="destructive" className="editor-notice">
            <AlertTitle>Action needs attention</AlertTitle>
            <AlertDescription>{actionError ?? snapshot.error}</AlertDescription>
            {snapshot.saveState === "error" && session.native && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => run(() => session.reloadNativeProject())}
                >
                  Reload disk version
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => run(() => session.reloadNativeProject(true))}
                >
                  Recover backup
                </Button>
              </>
            )}
            {snapshot.saveState === "error" && !session.native && (
              <Button size="sm" variant="outline" onClick={() => run(() => session.retrySave())}>
                Retry save
              </Button>
            )}
          </Alert>
        )}
        {snapshot.warnings.length > 0 && (
          <Alert role="status" className="editor-notice">
            <AlertTitle>Edit notes</AlertTitle>
            <AlertDescription>{snapshot.warnings.join(" ")}</AlertDescription>
          </Alert>
        )}
        {!!snapshot.reviewPendingCount && (
          <Alert role="status" className="editor-notice" data-tone="review">
            <RiCheckDoubleLine aria-hidden="true" />
            <AlertTitle>Agent edits to review</AlertTitle>
            <AlertDescription>
              {snapshot.reviewPendingCount === 1
                ? "1 edit batch is waiting for your review."
                : `${snapshot.reviewPendingCount} edit batches are waiting for your review.`}
            </AlertDescription>
            <Button
              size="sm"
              variant="outline"
              disabled={locked || snapshot.saveState !== "saved"}
              onClick={() => run(() => session.markReviewed())}
            >
              Mark agent edits reviewed
            </Button>
          </Alert>
        )}
        {snapshot.readOnly && !snapshot.unsupportedJSON && snapshot.saveState === "read-only" && (
          <Alert role="status" className="editor-notice">
            <AlertTitle>Another tab is editing this project</AlertTitle>
            <AlertDescription>
              You can review and download this copy. Close the other editing tab to make changes
              here.
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
              gridTemplateColumns: columns,
            }}
          >
            {sizes.mediaHidden ? (
              <PanelRail
                id="media-show"
                label="Show project media"
                icon={<RiFolderVideoLine aria-hidden="true" />}
                text="Panels"
                onShow={() => setPanelHidden("media", false)}
              />
            ) : (
              <SidePanel
                tab={sideTab}
                onTab={setSideTab}
                run={run}
                hideButton={
                  <Button
                    id="media-hide"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Hide project media"
                    aria-controls="side-panel"
                    title="Hide project media"
                    onClick={() => setPanelHidden("media", true)}
                  >
                    <RiContractLeftLine aria-hidden="true" />
                  </Button>
                }
              />
            )}
            {!sizes.mediaHidden && (
              <PanelDivider
                label="Media panel width"
                controls="side-panel"
                orientation="vertical"
                value={fitted.media}
                min={MEDIA_MIN}
                max={mediaMax}
                onChange={(value) => updatePanel("media", value)}
                onReset={() => updatePanel("media", DEFAULT_PANELS.media)}
              />
            )}
            <Viewer />
            {sizes.inspectorHidden ? (
              <PanelRail
                id="inspector-show"
                label="Show inspector"
                icon={<RiEqualizerLine aria-hidden="true" />}
                text="Inspector"
                onShow={() => setPanelHidden("inspector", false)}
              />
            ) : (
              <>
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
                    <Button
                      id="inspector-hide"
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Hide inspector"
                      aria-controls="inspector-panel"
                      title="Hide inspector"
                      onClick={() => setPanelHidden("inspector", true)}
                    >
                      <RiContractRightLine aria-hidden="true" />
                    </Button>
                  </div>
                  <div
                    className="editor-inspector-content"
                    role="region"
                    aria-label="Sequence and clip properties"
                    tabIndex={0}
                  >
                    <ClipInspector />
                  </div>
                </section>
              </>
            )}
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
          <Timeline run={run} />
        </div>
        <footer className="editor-statusbar">
          <span>
            <span
              className="editor-status-dot"
              data-state={
                snapshot.saveState === "error"
                  ? "error"
                  : snapshot.busy ||
                      snapshot.saveState === "loading" ||
                      snapshot.saveState === "saving"
                    ? "busy"
                    : snapshot.readOnly
                      ? "idle"
                      : "ready"
              }
            />
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
          {keymapError && (
            <span role="alert">Keyboard layout could not be saved on this device</span>
          )}
        </footer>
      </main>
    </TooltipProvider>
  );
}
