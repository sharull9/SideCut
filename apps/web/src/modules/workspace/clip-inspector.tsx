import { TransitionInspector } from "./transition-controls";
import { useEditorSession, useEditorView } from "./editor-session";
import { ClipTrimForm } from "./clip-trim-form";
import { ClipEditForm } from "./clip-edit-form";
import { ClipPropertiesForm } from "./clip-properties-form";
import { PictureInspector } from "./picture-controls";
import { EffectInspector } from "./effect-inspector";
import { KeyframeControls } from "./keyframe-controls";
import { ProjectSettings } from "./project-settings";
import { useState } from "react";
const INSPECTOR_TABS = [
  ["picture", "Picture"],
  ["effects", "Effects"],
  ["timing", "Timing"],
  ["transitions", "Transitions"],
] as const;
type InspectorTab = (typeof INSPECTOR_TABS)[number][0];

export function ClipInspector() {
  const { snapshot } = useEditorSession();
  const [tab, setTab] = useState<InspectorTab>("picture");
  const selected = useEditorView((state) => state.selected);
  const clips = [...snapshot.project.videoTracks, ...snapshot.project.audioTracks]
    .flatMap((track) => track.clips)
    .filter((clip) => selected.includes(clip.id));
  if (snapshot.unsupportedJSON)
    return (
      <div className="editor-inspector-section">
        <h3>Read-only project</h3>
        <p>
          This file uses unsupported project data. Download project preserves the original JSON.
          Open a supported project to edit.
        </p>
        <details>
          <summary>Original project JSON</summary>
          <pre className="editor-project-json">{snapshot.unsupportedJSON.slice(0, 50000)}</pre>
          {snapshot.unsupportedJSON.length > 50000 && (
            <p>Showing the first 50,000 characters. Download the project for the complete file.</p>
          )}
        </details>
      </div>
    );
  if (!clips.length)
    return (
      <>
        <ProjectSettings key={snapshot.project.id} />
        <div className="editor-selection-hint">
          <h3>No clip selected</h3>
          <p>
            Select a timeline clip to inspect its source range. Shift-click to select several clips.
          </p>
        </div>
      </>
    );
  const first = clips[0]!;
  const editable =
    clips.length === 1 ||
    (first.linkGroup != null && clips.every((c) => c.linkGroup === first.linkGroup));
  const picture = clips.some((c) =>
    snapshot.project.videoTracks.some((t) => t.clips.some((v) => v.id === c.id)),
  );
  const tabs = INSPECTOR_TABS.filter(([id]) => id !== "picture" || picture);
  const current = tabs.find(([id]) => id === tab)?.[0] ?? tabs[0]![0];
  return (
    <div className="editor-clip-inspector">
      <header className="editor-inspector-section editor-clip-summary">
        <h3>
          {clips.length === 1 ? (first.name ?? "Selected clip") : `${clips.length} clips selected`}
        </h3>
        {clips.length === 1 ? (
          <dl>
            <div>
              <dt>Start</dt>
              <dd>{first.start.seconds.toFixed(3)} s</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{first.duration.seconds.toFixed(3)} s</dd>
            </div>
            <div>
              <dt>Source in</dt>
              <dd>{first.sourceStart.seconds.toFixed(3)} s</dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd>{first.speed}×</dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted-foreground">
            {editable
              ? "Edits apply to the first clip; linked edges move by the same amount."
              : "Select one clip, or clips from the same link group, to edit them."}
          </p>
        )}
      </header>
      {editable && (
        <>
          <div
            className="editor-inspector-tabs"
            role="tablist"
            aria-label="Clip settings"
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              const index = tabs.findIndex(([id]) => id === current);
              const next =
                tabs[
                  (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length
                ]![0];
              setTab(next);
              event.currentTarget.querySelector<HTMLElement>(`#inspector-tab-${next}`)?.focus();
            }}
          >
            {tabs.map(([id, label]) => (
              <button
                key={id}
                id={`inspector-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={id === current}
                aria-controls="inspector-tab-panel"
                tabIndex={id === current ? 0 : -1}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            id="inspector-tab-panel"
            className="editor-inspector-section editor-inspector-panel"
            role="tabpanel"
            aria-labelledby={`inspector-tab-${current}`}
          >
            {current === "picture" && <PictureInspector clips={clips} />}
            {current === "effects" && (
              <>
                <EffectInspector clips={clips} />
                <KeyframeControls clips={clips} />
              </>
            )}
            {current === "timing" && (
              <>
                <ClipTrimForm key={`${first.id}:${snapshot.revision}`} clip={first} />
                <ClipEditForm key={`edit:${first.id}:${snapshot.revision}`} clip={first} />
                <ClipPropertiesForm
                  key={`properties:${first.id}:${snapshot.revision}`}
                  clip={first}
                />
              </>
            )}
            {current === "transitions" && <TransitionInspector clip={first} />}
          </div>
        </>
      )}
    </div>
  );
}
