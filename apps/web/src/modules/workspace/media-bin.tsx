import { useRef, useState, type ReactNode } from "react";
import {
  RiAddBoxLine,
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCloseLine,
  RiFilmLine,
  RiFolderOpenLine,
  RiFolderVideoLine,
  RiGalleryView2,
  RiImageLine,
  RiInsertColumnRight,
  RiListUnordered,
  RiSearchLine,
  RiUploadCloud2Line,
  RiVolumeUpLine,
} from "@remixicon/react";
import type { MediaItem } from "@sidecut/contracts/project";
import { Button } from "@sidecut/ui/components/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@sidecut/ui/components/empty";
import { Input } from "@sidecut/ui/components/input";
import { Tip } from "@sidecut/ui/components/tooltip";
import { useEditorSession } from "./editor-session";
import { placeSource, MEDIA_DRAG_TYPE } from "./placement";
import { MediaPlacementForm } from "./media-placement-form";
import { MediaAnalysisControls, TakeIdentification } from "./media-analysis-controls";
import { MediaThumb } from "./source-samples";
import { LocalAssetLibrary } from "./asset-library";
import { SavedSegments } from "./saved-segments";
import "./media-panel.css";

type View = "list" | "grid";
type KindFilter = "all" | MediaItem["kind"];

const VIEW_KEY = "sidecut.media-view.v1";
const KIND_ICON = { video: RiFilmLine, audio: RiVolumeUpLine, image: RiImageLine } as const;
const KIND_FILTERS: { id: KindFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "video", label: "Video" },
  { id: "audio", label: "Audio" },
  { id: "image", label: "Image" },
];

const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
};

const fileName = (path: string) => path.split(/[\\/]/).at(-1) ?? path;

function formatDuration(seconds: number) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function mediaMeta(item: MediaItem) {
  const parts: string[] = [];
  if (item.duration) parts.push(formatDuration(item.duration.seconds));
  else parts.push(item.kind === "image" ? "Image" : "Duration unknown");
  if (item.width && item.height) parts.push(`${item.width}×${item.height}`);
  return parts.join(" · ");
}

export function MediaBin({
  run,
  hideButton,
}: {
  run: (action: () => unknown) => void;
  hideButton?: ReactNode;
}) {
  const { session, snapshot, editor } = useEditorSession();
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [view, setView] = useState<View>(readView);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [expandedID, setExpandedID] = useState<string | null>(null);
  const disabled = snapshot.readOnly || snapshot.busy;
  const media = snapshot.project.media;
  const needle = query.trim().toLowerCase();
  const visible = media.filter(
    (item) =>
      (kind === "all" || item.kind === kind) &&
      (!needle || item.path.toLowerCase().includes(needle)),
  );
  const toggleView = () => {
    const next: View = view === "list" ? "grid" : "list";
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // The view preference is optional.
    }
  };
  const place = (item: MediaItem, mode: "place" | "insert") =>
    run(() => {
      const tracks =
        item.kind === "audio" ? snapshot.project.audioTracks : snapshot.project.videoTracks;
      const track = tracks.find((candidate) => !candidate.locked && candidate.targeted);
      if (!track) throw new Error("Add or unlock a compatible targeted track first.");
      const id = placeSource(session, item.id, track.id, editor.getState().playhead, mode);
      editor.getState().select(id);
    });
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
        <div className="editor-media-heading-actions">
          {media.length > 0 && (
            <Tip label={view === "list" ? "Grid view" : "List view"}>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={view === "list" ? "Switch to grid view" : "Switch to list view"}
                onClick={toggleView}
              >
                {view === "list" ? (
                  <RiGalleryView2 aria-hidden="true" />
                ) : (
                  <RiListUnordered aria-hidden="true" />
                )}
              </Button>
            </Tip>
          )}
          {session.native && (
            <Tip label="Watch folder">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Watch folder"
                disabled={disabled}
                onClick={() => run(() => session.watchFolder())}
              >
                <RiFolderOpenLine aria-hidden="true" />
              </Button>
            </Tip>
          )}
          <Tip label="Import local video, audio, or images">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Import media"
              disabled={disabled}
              onClick={() => picker.current?.click()}
            >
              <RiAddLine aria-hidden="true" />
            </Button>
          </Tip>
          {hideButton}
        </div>
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
      {media.length > 0 && (
        <div className="editor-media-toolbar">
          {media.length > 1 && (
            <div className="editor-media-filters">
              <div className="editor-media-search">
                <RiSearchLine aria-hidden="true" />
                <Input
                  type="search"
                  aria-label="Search media"
                  placeholder="Search media"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query && (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                  >
                    <RiCloseLine aria-hidden="true" />
                  </Button>
                )}
              </div>
              <div className="editor-media-segments" role="group" aria-label="Filter by kind">
                {KIND_FILTERS.map(({ id, label }) => {
                  const Icon = id === "all" ? null : KIND_ICON[id];
                  return (
                    <Tip key={id} label={label}>
                      <button
                        type="button"
                        aria-pressed={kind === id}
                        aria-label={label}
                        onClick={() => setKind(id)}
                      >
                        {Icon ? <Icon aria-hidden="true" /> : "All"}
                      </button>
                    </Tip>
                  );
                })}
              </div>
            </div>
          )}
          <TakeIdentification run={run} disabled={disabled} />
        </div>
      )}
      <div
        className="editor-panel-content"
        role="region"
        aria-label="Project media contents"
        tabIndex={0}
      >
        {media.length === 0 ? (
          <Empty className="editor-media-empty">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <RiFolderVideoLine aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No media yet</EmptyTitle>
              <EmptyDescription>
                Drop video, audio, or images here to start your edit. Your files stay on this
                device.
              </EmptyDescription>
            </EmptyHeader>
            <Button size="sm" disabled={disabled} onClick={() => picker.current?.click()}>
              <RiAddLine aria-hidden="true" data-icon="inline-start" />
              Choose files
            </Button>
          </Empty>
        ) : visible.length === 0 ? (
          <div className="editor-media-empty-filter">
            <p>No media matches your filters.</p>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setQuery("");
                setKind("all");
              }}
            >
              Clear filters
            </Button>
          </div>
        ) : (
          <ul className="editor-media-list" data-view={view}>
            {visible.map((item) => {
              const availability = snapshot.mediaAvailability[item.id];
              const state = availability?.state;
              const Icon = KIND_ICON[item.kind];
              const name = fileName(item.path);
              const expanded = expandedID === item.id;
              const statusText = !availability
                ? "Checking source…"
                : state === "available"
                  ? "On this device"
                  : `${state}: ${availability.detail}`;
              return (
                <li
                  key={item.id}
                  className="editor-media-item"
                  data-testid="media-item"
                  data-selected={selectedID === item.id || expanded}
                  data-expanded={expanded}
                  draggable={!disabled && state === "available"}
                  onClick={() => setSelectedID(item.id)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(MEDIA_DRAG_TYPE, item.id);
                    event.dataTransfer.effectAllowed = "copy";
                  }}
                >
                  <div className="editor-media-row">
                    <span className="editor-media-thumb">
                      <MediaThumb mediaID={item.id} audio={item.kind === "audio"} />
                      <span className="editor-media-badge" aria-hidden="true">
                        <Icon />
                      </span>
                    </span>
                    <span className="editor-media-text">
                      <Tip label={item.path}>
                        <span className="editor-media-name">{name}</span>
                      </Tip>
                      <span className="editor-media-meta">
                        <Tip label={statusText}>
                          <span
                            className="editor-media-dot"
                            role="img"
                            aria-label={statusText}
                            data-state={
                              !availability ? "checking" : state === "available" ? state : "missing"
                            }
                          />
                        </Tip>
                        <span>{mediaMeta(item)}</span>
                      </span>
                      {availability && state !== "available" && (
                        <RelinkSource id={item.id} path={item.path} disabled={disabled} run={run} />
                      )}
                    </span>
                    <span className="editor-media-actions">
                      {(["place", "insert"] as const).map((mode) => (
                        <Tip
                          key={mode}
                          label={
                            mode === "insert"
                              ? "Insert at playhead on the first targeted track"
                              : "Place at playhead on the first targeted track"
                          }
                        >
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            disabled={disabled || state !== "available"}
                            aria-label={`${mode === "insert" ? "Insert" : "Place"} ${item.path}`}
                            onClick={() => place(item, mode)}
                          >
                            {mode === "insert" ? (
                              <RiInsertColumnRight aria-hidden="true" />
                            ) : (
                              <RiAddBoxLine aria-hidden="true" />
                            )}
                          </Button>
                        </Tip>
                      ))}
                      <Tip label={expanded ? "Hide settings" : "Role, take and analysis settings"}>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-expanded={expanded}
                          aria-controls={`media-more-${item.id}`}
                          aria-label={`More settings for ${name}`}
                          onClick={() => {
                            setSelectedID(item.id);
                            setExpandedID(expanded ? null : item.id);
                          }}
                        >
                          {expanded ? (
                            <RiArrowUpSLine aria-hidden="true" />
                          ) : (
                            <RiArrowDownSLine aria-hidden="true" />
                          )}
                        </Button>
                      </Tip>
                    </span>
                  </div>
                  <div
                    id={`media-more-${item.id}`}
                    className="editor-media-more"
                    hidden={!expanded}
                  >
                    <MediaPlacementForm
                      key={`${item.id}:${item.role}:${item.takeID}:${item.takeOffset?.flicks}`}
                      item={item}
                    />
                    <MediaAnalysisControls item={item} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="editor-media-sections">
          <LocalAssetLibrary />
          <SavedSegments />
        </div>
      </div>
      {dragging && (
        <div className="editor-media-drop" aria-hidden="true">
          <RiUploadCloud2Line />
          Drop to import
        </div>
      )}
      <div className="editor-panel-footnote" role="status">
        <RiFolderVideoLine aria-hidden="true" />
        {snapshot.busy
          ? "Working with local files…"
          : dragging
            ? "Drop files to import"
            : `${media.length} sources · local files only`}
      </div>
    </section>
  );
}

function RelinkSource({
  id,
  path,
  disabled,
  run,
}: {
  id: string;
  path: string;
  disabled: boolean;
  run: (action: () => unknown) => void;
}) {
  const { session } = useEditorSession();
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        className="editor-media-relink"
        variant="outline"
        size="xs"
        aria-label="Relink source"
        disabled={disabled}
        onClick={() => picker.current?.click()}
      >
        Relink
      </Button>
      <input
        ref={picker}
        type="file"
        className="sr-only"
        tabIndex={-1}
        disabled={disabled}
        aria-label={`Relink ${path}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) run(() => session.relinkMedia(id, file));
        }}
      />
    </>
  );
}
