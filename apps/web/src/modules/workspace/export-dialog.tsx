import { useEffect, useRef, useState } from "react";
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
import { missingFonts, missingFontWarning } from "@sidecut/core/text";
import { fontAvailable } from "@sidecut/platform-browser/text";
import { useFontVersion } from "./text-inspector";
import { useEditorSession } from "./editor-session";

export function ExportDialog() {
  const { session, snapshot, editor } = useEditorSession();
  const [open, setOpen] = useState(false),
    [status, setStatus] = useState<"idle" | "exporting" | "done" | "cancelled" | "error">("idle"),
    [progress, setProgress] = useState(0),
    [error, setError] = useState<string | null>(null),
    [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useFontVersion();
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    setDownload(null);
    setStatus("idle");
    setError(null);
  }, [snapshot.project.id, snapshot.revision]);
  useEffect(
    () => () => {
      if (download) URL.revokeObjectURL(download.url);
    },
    [download],
  );
  let issue: string | null = null;
  let plan: ReturnType<typeof exportPlan> | null = null;
  try {
    plan = exportPlan(snapshot.project);
  } catch (cause) {
    issue = cause instanceof Error ? cause.message : String(cause);
  }
  const start = async () => {
    editor.getState().setPlaying(false);
    const abort = new AbortController();
    controller.current = abort;
    setStatus("exporting");
    setError(null);
    setProgress(0);
    setDownload(null);
    const filename = snapshot.project.name.replace(/[\\/:*?"<>|]/g, "_") || "SideCut";
    try {
      const blob = await session.exportWebM(abort.signal, setProgress);
      if (abort.signal.aborted) {
        setStatus("cancelled");
        return;
      }
      setDownload({ url: URL.createObjectURL(blob), name: `${filename}.webm` });
      setStatus("done");
    } catch (cause) {
      if (abort.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError"))
        setStatus("cancelled");
      else {
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus("error");
      }
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) controller.current?.abort();
        setOpen(value);
      }}
    >
      <DialogTrigger
        render={<Button size="sm" disabled={snapshot.busy || snapshot.saveState === "loading"} />}
      >
        Export
      </DialogTrigger>
      <DialogContent className="dark">
        <DialogHeader>
          <DialogTitle>Export WebM</DialogTitle>
          <DialogDescription>
            Render picture and audio tracks locally with VP8 video and Opus sound, using the
            project's export loudness and peak ceiling. Sequences can be up to five minutes.
          </DialogDescription>
        </DialogHeader>
        {plan && (
          <p>
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
        {missingFonts(snapshot.project, fontAvailable, true).map((font) => (
          <Alert key={font.name}>
            <AlertTitle>Missing font</AlertTitle>
            <AlertDescription>{missingFontWarning(font)}</AlertDescription>
          </Alert>
        ))}
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Export failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {status === "exporting" && (
          <Progress value={Math.round(progress * 100)} aria-label="Export progress" />
        )}
        <p role="status">
          {status === "exporting"
            ? `Rendering ${Math.round(progress * 100)}%`
            : status === "done"
              ? "Your video is ready to download."
              : status === "cancelled"
                ? "Export cancelled. No partial file was downloaded."
                : "Output fits within 1920 × 1080, or 1080 × 1920 for portrait projects."}
        </p>
        <DialogFooter>
          {status === "exporting" ? (
            <Button variant="outline" onClick={() => controller.current?.abort()}>
              Cancel export
            </Button>
          ) : (
            <Button disabled={Boolean(issue) || snapshot.busy} onClick={() => void start()}>
              {status === "done" ? "Render again" : "Render WebM"}
            </Button>
          )}
          {download && (
            <Button
              render={<a href={download.url} download={download.name} />}
              nativeButton={false}
            >
              Download WebM
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
