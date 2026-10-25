import { useEffect, useState } from "react";
import { RiScissorsCutLine } from "@remixicon/react";
import { MediaSection } from "./media-section";
import { SegmentLibrary, type SegmentEntry } from "@sidecut/platform-browser/segments";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { Field, FieldLabel, FieldDescription, FieldError } from "@sidecut/ui/components/field";
import { useEditorSession, useEditorView } from "./editor-session";
export function SavedSegments() {
  const { session, snapshot, editor } = useEditorSession(),
    selected = useEditorView((s) => s.selected);
  const [entries, setEntries] = useState<SegmentEntry[]>([]),
    [query, setQuery] = useState(""),
    [name, setName] = useState(""),
    [version, setVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [mode, setMode] = useState<"place" | "overwrite" | "insert">("place");
  useEffect(() => {
    let active = true;
    void SegmentLibrary.open()
      .then(async (lib) => {
        try {
          const rows = await lib.list(query);
          if (active) setEntries(rows);
        } finally {
          lib.close();
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [query, version]);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const disabled = busy || snapshot.busy || snapshot.readOnly;
  return (
    <MediaSection
      icon={<RiScissorsCutLine aria-hidden="true" />}
      title="Saved segments"
      count={entries.length}
    >
      <>
        <FieldDescription>
          Save selected clips and local files for reuse in another project. Linked clips join the
          selection. Existing segment names are preserved.
        </FieldDescription>
        <Field>
          <FieldLabel htmlFor="segment-name">Segment name</FieldLabel>
          <Input
            id="segment-name"
            value={name}
            maxLength={80}
            disabled={disabled}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Button
          size="sm"
          disabled={disabled || !selected.length || !name.trim()}
          onClick={() =>
            void run(async () => {
              await session.saveSelectionAsSegment(editor.getState().selected, name);
              setNotice("Selection and resources saved as a reusable segment.");
            })
          }
        >
          Save selection as segment
        </Button>
        <Field>
          <FieldLabel htmlFor="segment-search">Find segment</FieldLabel>
          <Input id="segment-search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="segment-mode">Insert mode</FieldLabel>
          <select
            id="segment-mode"
            value={mode}
            disabled={disabled}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="place">Place without overlap</option>
            <option value="overwrite">Overwrite</option>
            <option value="insert">Insert time</option>
          </select>
        </Field>
        {!entries.length && <p>No saved segments match.</p>}
        <ul className="editor-asset-results">
          {entries.map((entry) => (
            <li key={entry.segment.id}>
              <strong>{entry.segment.name}</strong>
              <small>
                {entry.segment.template.duration.seconds.toFixed(2)} s ·{" "}
                {entry.segment.template.clips.length} clips · {entry.segment.resources.length} files
              </small>
              {entry.segment.notes.map((note, i) => (
                <small key={i}>{note}</small>
              ))}
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    const result = await session.insertSavedSegment(
                        entry,
                        editor.getState().playhead.seconds,
                        mode,
                      ),
                      id = result.createdIDs.find((v) => v.startsWith("clip_"));
                    if (id) editor.getState().select(id);
                    setNotice(`Inserted ${entry.segment.name}. One undo removes the insertion.`);
                  })
                }
              >
                Insert at playhead
              </Button>
            </li>
          ))}
        </ul>
        {notice && <p role="status">{notice}</p>}
        {error && <FieldError>{error}</FieldError>}
      </>
    </MediaSection>
  );
}
