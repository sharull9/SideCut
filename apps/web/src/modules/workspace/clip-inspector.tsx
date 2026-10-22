import { useEditorSession, useEditorView } from "./editor-session";
import { ClipTrimForm } from "./clip-trim-form";
import { ClipEditForm } from "./clip-edit-form";
import { ClipPropertiesForm } from "./clip-properties-form";
import { PictureInspector } from "./picture-controls";
import { KeyframeControls } from "./keyframe-controls";
import { ProjectSettings } from "./project-settings";
import { Button } from "@sidecut/ui/components/button";
export function ClipInspector() {
  const { snapshot, editor } = useEditorSession();
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
        <ProjectSettings key={`${snapshot.project.id}:${snapshot.revision}`} />
        <div className="editor-selection-hint">
          <h3>No clip selected</h3>
          <p>
            Select a timeline clip to inspect its source range. Shift-click to select several clips.
          </p>
        </div>
      </>
    );
  return (
    <div className="editor-inspector-section">
      <Button variant="ghost" size="xs" onClick={() => editor.getState().select(null)}>
        Sequence properties
      </Button>
      <h3>
        {clips.length === 1
          ? (clips[0]?.name ?? "Selected clip")
          : `${clips.length} clips selected`}
      </h3>
      <dl>
        {clips.map((clip) => (
          <div className="editor-clip-properties" key={clip.id}>
            <dt>{clip.name ?? clip.id}</dt>
            <dd>
              Start {clip.start.seconds.toFixed(3)} s<br />
              Duration {clip.duration.seconds.toFixed(3)} s<br />
              Source in {clip.sourceStart.seconds.toFixed(3)} s<br />
              Speed {clip.speed}×
            </dd>
          </div>
        ))}
      </dl>
      {clips[0] &&
        (clips.length === 1 ||
          (clips[0].linkGroup && clips.every((c) => c.linkGroup === clips[0]?.linkGroup))) && (
          <>
            {clips.length > 1 && (
              <p>Trim the first clip and shift linked edges by the same amount.</p>
            )}
            <PictureInspector clips={clips} />
            <KeyframeControls clips={clips} />
            <ClipTrimForm key={`${clips[0].id}:${snapshot.revision}`} clip={clips[0]} />
            <ClipEditForm key={`edit:${clips[0].id}:${snapshot.revision}`} clip={clips[0]} />
            <ClipPropertiesForm
              key={`properties:${clips[0].id}:${snapshot.revision}`}
              clip={clips[0]}
            />
          </>
        )}
    </div>
  );
}
