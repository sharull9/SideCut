import { useEffect, useRef, useState } from "react";
import type { Clip } from "@sidecut/contracts/project";
import { pictureTime } from "@sidecut/core/render-plan";
import { LocalMediaReader } from "@sidecut/platform-browser/preview";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@sidecut/ui/components/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "@sidecut/ui/components/field";
import { useEditorSession } from "./editor-session";

export function RegionZoomDialog({ clip, disabled }: { clip: Clip; disabled: boolean }) {
  const { session, snapshot, editor } = useEditorSession();
  const [open, setOpen] = useState(false),
    [rect, setRect] = useState({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }),
    [animate, setAnimate] = useState(false),
    [duration, setDuration] = useState("0.5"),
    [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    drag = useRef<{ x: number; y: number } | null>(null);
  const reference = clip.content.media as { mediaID?: string } | undefined;
  const media = snapshot.project.media.find((m) => m.id === reference?.mediaID);
  useEffect(() => {
    if (!open || !media) return;
    let cancelled = false,
      reader: LocalMediaReader | null = null;
    setError(null);
    void (async () => {
      try {
        const local = await session.resource(media.id);
        if (cancelled) return;
        if (!local || local.state !== "available")
          throw new Error(
            "The source is missing on this device. Enter source coordinates below or import the source.",
          );
        reader = await LocalMediaReader.open(local.file, media.kind, 720);
        if (cancelled) {
          reader.close();
          return;
        }
        const frame = await reader.frame(
          pictureTime(snapshot.project, clip, editor.getState().playhead.seconds),
        );
        if (cancelled || !canvas.current || !frame) return;
        canvas.current.width = frame.width;
        canvas.current.height = frame.height;
        canvas.current.getContext("2d")?.drawImage(frame.canvas, 0, 0);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        reader?.close();
      }
    })();
    return () => {
      cancelled = true;
      reader?.close();
    };
  }, [open, media, session, clip, snapshot.project, editor]);
  const point = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
    };
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const p = point(e),
      a = drag.current;
    setRect({
      x: Math.min(a.x, p.x),
      y: Math.min(a.y, p.y),
      width: Math.abs(p.x - a.x),
      height: Math.abs(p.y - a.y),
    });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="xs"
            variant="outline"
            disabled={disabled || !media?.width || !media.height}
          />
        }
      >
        Select source region
      </DialogTrigger>
      <DialogContent className="dark editor-region-dialog">
        <DialogHeader>
          <DialogTitle>Zoom to source region</DialogTitle>
          <DialogDescription>
            Draw a rectangle on the original source, or enter fractions below. The selected region
            fits inside the canvas.
          </DialogDescription>
        </DialogHeader>
        <div
          className="editor-region-source"
          style={{
            aspectRatio: `${media?.width ?? 16}/${media?.height ?? 9}`,
            maxWidth: `${(35 * (media?.width ?? 16)) / (media?.height ?? 9)}dvh`,
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            drag.current = point(e);
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={move}
          onPointerUp={(e) => {
            move(e);
            drag.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <canvas ref={canvas} aria-label="Source region preview" />
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
          </svg>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            try {
              editor.getState().setPlaying(false);
              session.apply({
                label: "Zoom to region",
                expectedRevision: snapshot.revision,
                commands: [
                  {
                    zoomToRegion: {
                      clipID: clip.id,
                      rect,
                      ...(animate
                        ? { at: editor.getState().playhead.seconds, duration: Number(duration) }
                        : {}),
                    },
                  },
                ],
              });
              setOpen(false);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause));
            }
          }}
        >
          <FieldGroup>
            {(["x", "y", "width", "height"] as const).map((key) => (
              <Field key={key} orientation="horizontal">
                <FieldLabel htmlFor={`region-${key}`}>Region {key}</FieldLabel>
                <Input
                  id={`region-${key}`}
                  type="number"
                  min={key === "width" || key === "height" ? "0.000001" : "0"}
                  max="1"
                  step="any"
                  required
                  value={rect[key]}
                  onChange={(e) => setRect((r) => ({ ...r, [key]: Number(e.target.value) }))}
                />
              </Field>
            ))}
            <Field orientation="horizontal">
              <FieldLabel htmlFor="region-animate">Animate from playhead</FieldLabel>
              <input
                id="region-animate"
                type="checkbox"
                checked={animate}
                onChange={(e) => setAnimate(e.target.checked)}
              />
            </Field>
            {animate && (
              <Field>
                <FieldLabel htmlFor="region-duration">Zoom duration (s)</FieldLabel>
                <Input
                  id="region-duration"
                  type="number"
                  min="0.000001"
                  step="any"
                  required
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
                <FieldDescription>The whole zoom must fit inside this clip.</FieldDescription>
              </Field>
            )}
            {error && <FieldError role="alert">{error}</FieldError>}
            <Button type="submit" disabled={disabled || rect.width <= 0 || rect.height <= 0}>
              Apply region zoom
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
