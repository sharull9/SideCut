import { useState, useSyncExternalStore } from "react";
import { Button } from "@sidecut/ui/components/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@sidecut/ui/components/dialog";
import { Progress } from "@sidecut/ui/components/progress";
import { Alert, AlertTitle, AlertDescription } from "@sidecut/ui/components/alert";
import { exportPlan } from "@sidecut/core/render-plan";
import { presetProject, type ExportPreset } from "@sidecut/core/export-presets";
import { missingFonts, missingFontWarning } from "@sidecut/core/text";
import { fontAvailable } from "@sidecut/platform-browser/text";
import { useFontVersion } from "./text-inspector";
import { formatOf, formatProject } from "@sidecut/core/formats";
import { useEditorSession } from "./editor-session";
import "./dialogs.css";

export function ExportDialog() {
  const { session, snapshot, editor } = useEditorSession();
  const [formatID, setFormatID] = useState(""),
    [preset, setPreset] = useState<ExportPreset | "wav">("webm"),
    [error, setError] = useState<string | null>(null);
  const entries = useSyncExternalStore(
    session.exports.subscribe,
    session.exports.getSnapshot,
    session.exports.getSnapshot,
  );
  const format = formatOf(snapshot.project, formatID),
    rendered = presetProject(
      formatProject(snapshot.project, format?.id),
      preset === "wav" ? "webm" : preset,
    );
  useFontVersion();
  let issue: string | null = null,
    plan: ReturnType<typeof exportPlan> | null = null;
  try {
    plan = exportPlan(rendered);
  } catch (cause) {
    issue = cause instanceof Error ? cause.message : String(cause);
  }
  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" disabled={snapshot.saveState === "loading"} />}>
        Export
        {entries.some((e) => e.status === "running" || e.status === "queued") ? " · working" : ""}
      </DialogTrigger>
      <DialogContent className="dark editor-dialog editor-dialog-wide editor-export-dialog">
        <DialogHeader>
          <DialogTitle>Export WebM</DialogTitle>
          <DialogDescription>
            Render WebM video or WAV audio locally. Queue up to five exports. Downloads stay
            available here until removed or the project closes.
          </DialogDescription>
        </DialogHeader>
        {plan && (
          <p className="editor-dialog-summary">
            {plan.width} × {plan.height} · {Number(plan.fps.toFixed(3))} fps ·{" "}
            {plan.duration.toFixed(2)} s
          </p>
        )}
        {issue && (
          <Alert>
            <AlertTitle>Export needs attention</AlertTitle>
            <AlertDescription>{issue}</AlertDescription>
          </Alert>
        )}
        <label>
          Preset
          <select
            value={preset}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "webm" ||
                value === "review" ||
                value === "youtube1080" ||
                value === "short" ||
                value === "wav"
              )
                setPreset(value);
            }}
          >
            <option value="webm">Main canvas · WebM</option>
            <option value="review">Review · 720p WebM</option>
            <option value="youtube1080">1080p WebM</option>
            <option value="short">Portrait · WebM</option>
            <option value="wav">Audio only · WAV</option>
          </select>
        </label>
        {snapshot.project.settings.alternateFormats.length > 0 && (
          <label className="editor-export-format">
            Format
            <select value={format?.id ?? ""} onChange={(event) => setFormatID(event.target.value)}>
              <option value="">Main canvas</option>
              {snapshot.project.settings.alternateFormats.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.width} × {f.height}
                </option>
              ))}
            </select>
          </label>
        )}
        {missingFonts(rendered, fontAvailable, true).map((font) => (
          <Alert key={font.name}>
            <AlertTitle>Missing font</AlertTitle>
            <AlertDescription>{missingFontWarning(font)}</AlertDescription>
          </Alert>
        ))}
        {error && <p role="alert">{error}</p>}
        <ol className="editor-export-list" aria-label="Export queue" aria-live="polite">
          {entries.map((entry) => (
            <li key={entry.id}>
              <strong>{entry.name}</strong>
              <span>
                {entry.status}
                {entry.status === "running" ? ` ${Math.round(entry.progress * 100)}%` : ""}
              </span>
              {entry.status === "running" && (
                <Progress
                  value={Math.round(entry.progress * 100)}
                  aria-label={`Export progress for ${entry.name}`}
                />
              )}
              {entry.status === "failed" && <p role="alert">{entry.error}</p>}
              {entry.status === "done" && (
                <Button
                  render={<a href={entry.url} download={entry.name} />}
                  nativeButton={false}
                  variant="outline"
                  size="sm"
                >
                  Download {entry.name.endsWith(".wav") ? "WAV" : "WebM"}
                </Button>
              )}
              {entry.status === "queued" || entry.status === "running" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => session.exports.cancel(entry.id)}
                >
                  Cancel export
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => session.exports.remove(entry.id)}>
                  Remove export
                </Button>
              )}
            </li>
          ))}
        </ol>
        <p role="status">
          Exports run in order. If the project changes before a queued export starts, queue it
          again. Output fits 1920 × 1080, or 1080 × 1920 for portrait.
        </p>
        <DialogFooter>
          <Button
            disabled={Boolean(issue) || snapshot.readOnly || entries.length >= 5}
            onClick={() => {
              try {
                setError(null);
                editor.getState().setPlaying(false);
                session.queueExport(format?.id ?? null, preset);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            }}
          >
            Queue export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
