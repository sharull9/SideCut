import { useRef, useState } from "react";
import {
  RiFolderVideoLine,
  RiFilmLine,
  RiImageLine,
  RiVolumeUpLine,
  RiAddLine,
} from "@remixicon/react";
import { Button } from "@sidecut/ui/components/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@sidecut/ui/components/empty";
import { useEditorSession } from "./editor-session";

export function MediaBin({ run }: { run: (action: () => unknown) => void }) {
  const { session, snapshot } = useEditorSession();
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const disabled = snapshot.readOnly || snapshot.busy;
  return (
    <section
      id="media-panel"
      aria-labelledby="media-title"
      className="editor-panel editor-media-panel"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? "none" : "copy";
          if (!disabled) setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) {
          const files = Array.from(event.dataTransfer.files);
          run(() => session.importFiles(files));
        }
      }}
      data-dragging={dragging}
    >
      <div className="editor-panel-heading">
        <h1 id="media-title">Project media</h1>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Import media"
          title="Import local video, audio, or images"
          disabled={disabled}
          onClick={() => picker.current?.click()}
        >
          <RiAddLine aria-hidden="true" />
        </Button>
      </div>
      <input
        ref={picker}
        type="file"
        accept="video/*,audio/*,image/*,.mov,.mkv,.m4a,.flac,.aiff"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Local media files"
        disabled={disabled}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          run(() => session.importFiles(files));
        }}
      />
      <div
        className="editor-panel-content"
        role="region"
        aria-label="Project media contents"
        tabIndex={0}
      >
        {snapshot.project.media.length ? (
          <ul className="editor-media-list">
            {snapshot.project.media.map((item) => {
              const availability = snapshot.mediaAvailability[item.id];
              const Icon =
                item.kind === "audio"
                  ? RiVolumeUpLine
                  : item.kind === "image"
                    ? RiImageLine
                    : RiFilmLine;
              return (
                <li key={item.id} className="editor-media-item" data-testid="media-item">
                  <div className="editor-media-item-title">
                    <Icon aria-hidden="true" />
                    <span title={item.path}>{item.path.split(/[\\/]/).at(-1)}</span>
                  </div>
                  <p>
                    {item.kind} ·{" "}
                    {item.duration
                      ? `${item.duration.seconds.toFixed(2)} s`
                      : item.kind === "image"
                        ? "Still image"
                        : "Duration unknown"}
                    {item.width && item.height ? ` · ${item.width} × ${item.height}` : ""}
                  </p>
                  <p className="editor-media-availability" title={availability?.detail}>
                    {availability
                      ? availability.state === "available"
                        ? "On this device"
                        : `${availability.state}: ${availability.detail}`
                      : "Checking source…"}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RiFolderVideoLine aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No media yet</EmptyTitle>
              <EmptyDescription>
                Drop video, audio, or images here. Your files stay on this device.
              </EmptyDescription>
            </EmptyHeader>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => picker.current?.click()}
            >
              Choose files
            </Button>
          </Empty>
        )}
      </div>
      <div className="editor-panel-footnote" role="status">
        <RiFolderVideoLine aria-hidden="true" />
        {snapshot.busy
          ? "Working with local files…"
          : dragging
            ? "Drop files to import"
            : `${snapshot.project.media.length} sources · local files only`}
      </div>
    </section>
  );
}
