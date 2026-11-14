import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DEFAULT_LIVE_ASSETS, LIVE_BACKGROUNDS, liveAssets } from "@sidecut/core/live-assets";
import type { LiveAssets, LiveOverlay } from "@sidecut/core/live-assets";
import { DEFAULT_LIVE_AUDIO, type LiveAudioSettings } from "@sidecut/core/live-audio";
import { liveQualityProfiles, type LiveStudio } from "@sidecut/core/live-studio";
import { LiveAudioMixer, type LiveAudioChannel } from "@sidecut/platform-browser/live-audio";
import { LiveStudioOutput } from "@sidecut/platform-browser/live-studio";
import { LocalMediaReader } from "@sidecut/platform-browser/preview";
import { RecentClips } from "@sidecut/platform-browser/recent-clips";
import { recordingLimits } from "@sidecut/platform-browser/recording";
import { Button, buttonVariants } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { useNavigate } from "@tanstack/react-router";
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiCloseLine,
  RiComputerLine,
  RiDeleteBinLine,
  RiFlagLine,
  RiFullscreenExitLine,
  RiFullscreenLine,
  RiMicLine,
  RiMusic2Line,
  RiPlayFill,
  RiRecordCircleFill,
  RiRefreshLine,
  RiStopFill,
  RiVideoOnLine,
} from "@remixicon/react";
import { useEditorSession } from "@/modules/workspace/editor-session";
import { nativeBridge } from "@/modules/workspace/host-coordinator";
import { NativeRecordingControls } from "@/modules/workspace/native-recording-controls";
import { megabytes, type UploadProgress } from "./cloud-upload";
import { addTakeToProject, placedMessage } from "./place-take";
import {
  TakeWriter,
  listTakes,
  pruneTakes,
  removeTake,
  takeFile,
  updateTake,
  type TakeInfo,
} from "./take-store";
import { openTakeSink } from "./take-sink";
import type { StudioCloud } from "@/modules/cloud/studio-cloud";
import { loadStudio, saveStudio } from "./studio-store";
import {
  ClipCapture,
  StudioCapture,
  captureNeedsResolution,
  clipsNeedResolution,
  type CaptureDeps,
} from "./studio-capture";
import {
  defaultLayout,
  fillLayout,
  fitLayout,
  sourceRect,
  type SourceLayout,
} from "./source-layout";
import { SourceStage } from "./source-stage";
import "./studio.css";

type VideoSource = {
  id: string;
  kind: "camera" | "screen";
  label: string;
  layout: SourceLayout;
  video: HTMLVideoElement;
  stream: MediaStream;
};
type AudioInput = { id: string; label: string; stream: MediaStream; channel: LiveAudioChannel };
type Recovered = TakeInfo & { bytes: number };
type Mode = "record" | "live" | "both";
type SaveTo = "device" | "cloud";
const SAVE_TO_KEY = "sidecut.studio.saveTo";
const readSaveTo = (): SaveTo => {
  try {
    return localStorage.getItem(SAVE_TO_KEY) === "device" ? "device" : "cloud";
  } catch {
    return "cloud";
  }
};
const message = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;
const OVERLAY_BOUNDS: Record<
  LiveOverlay["kind"],
  Pick<LiveOverlay, "x" | "y" | "width" | "height">
> = {
  banner: { x: 0.05, y: 0.8, width: 0.9, height: 0.12 },
  takeover: { x: 0, y: 0, width: 1, height: 1 },
  highlight: { x: 0.6, y: 0.05, width: 0.35, height: 0.2 },
};

const sourceAspect = (video: HTMLVideoElement) =>
  video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;

/** Draws sources bottom to top, each where the user placed it on the program canvas. */
function paintSources(context: CanvasRenderingContext2D, sources: readonly VideoSource[]) {
  const { width, height } = context.canvas;
  for (const { video, layout } of sources) {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) continue;
    const rect = sourceRect(layout, width / height, sourceAspect(video));
    context.drawImage(video, rect.x * width, rect.y * height, rect.w * width, rect.h * height);
  }
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="studio-section" aria-label={title}>
      <header>
        <div className="min-w-0">
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{action}</div>}
      </header>
      {children}
    </section>
  );
}

export default function StudioPanel({
  onBusy,
  cloud,
}: {
  onBusy: (busy: boolean) => void;
  cloud: StudioCloud;
}) {
  const { session, snapshot } = useEditorSession();
  const navigate = useNavigate();
  // Live goes through the desktop app's native recorder; browsers cannot reach RTMP.
  const canStream = Boolean(nativeBridge()?.nativeRecordingStart);
  const projectID = useRef(snapshot.project.id).current;
  const canvas = useRef<HTMLCanvasElement>(null);
  const studio = useRef<LiveStudio | null>(null);
  const output = useRef<LiveStudioOutput | null>(null);
  const mixer = useRef<LiveAudioMixer | null>(null);
  const sources = useRef<VideoSource[]>([]);
  const audioInputs = useRef<AudioInput[]>([]);
  const sounds = useRef(new Map<string, AudioBuffer>());
  const persist = useRef<Promise<void>>(Promise.resolve());
  const [, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [frame, setFrame] = useState<string | null>(null);
  const [name, setName] = useState("Scene 1");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<LiveAssets>(DEFAULT_LIVE_ASSETS);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const sourceNumbers = useRef({ camera: 0, screen: 0 });
  /** The program canvas's shape; a placeholder until the first frame sizes it. */
  const canvasAspect = () => {
    const element = canvas.current;
    return frame && element?.width && element.height ? element.width / element.height : 16 / 9;
  };
  const [overlayText, setOverlayText] = useState("");
  const [overlayKind, setOverlayKind] = useState<LiveOverlay["kind"]>("banner");
  const [settings, setSettings] = useState<Record<string, LiveAudioSettings>>({});
  const [meters, setMeters] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<Mode>("record");
  const [saveTo, setSaveToState] = useState<SaveTo>(readSaveTo);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const toCloud = saveTo === "cloud" && cloud.state === "ready";
  const setSaveTo = (next: SaveTo) => {
    setSaveToState(next);
    try {
      localStorage.setItem(SAVE_TO_KEY, next);
    } catch {
      // Private browsing: the choice lasts for this page only.
    }
  };
  const [recovered, setRecovered] = useState<Recovered[]>([]);
  // Points at this render's programStream so the long-lived clip controller never goes stale.
  const latestStream = useRef<(() => Promise<{ stream: MediaStream; audio: MediaStream }>) | null>(
    null,
  );
  const clips = useRef<ClipCapture | null>(null);
  // The clip controller is the only source for buffer and saved-clip UI.
  clips.current ??= new ClipCapture({
    buffer: new RecentClips(),
    acquire: () => latestStream.current!(),
    createURL: (file) => URL.createObjectURL(file),
    revokeURL: (url) => URL.revokeObjectURL(url),
  });
  const clipState = useSyncExternalStore(clips.current.subscribe, () => clips.current!.state);
  const armed = clipState.buffer.kind === "armed";
  const saving = clipState.product.kind === "saving";
  const clip =
    clipState.product.kind === "retained" || clipState.product.kind === "importing"
      ? clipState.product.clip
      : null;
  // Points at this render's sink options (cloud or device) for the long-lived capture controller.
  const latestSink = useRef<CaptureDeps["openSink"] | null>(null);
  const capture = useRef<StudioCapture | null>(null);
  // The capture controller is the only source for recording, saving, upload and take UI.
  capture.current ??= new StudioCapture({
    acquire: async () => (await latestStream.current!()).stream,
    createRecorder: (stream) => {
      const profile = liveQualityProfiles.standard;
      return new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp8,opus",
        videoBitsPerSecond: profile.videoBitsPerSecond,
        audioBitsPerSecond: profile.audioBitsPerSecond,
      });
    },
    openSink: (fileName, report) => latestSink.current!(fileName, report),
    fileName: () => `studio-${Date.now()}.webm`,
    now: () => performance.now(),
    revokeURL: (url) => URL.revokeObjectURL(url),
    removeStored: (fileName) => void removeTake(fileName),
    encoderMessage: "The recording encoder failed. Add or discard this take.",
  });
  const program = useSyncExternalStore(capture.current.subscribe, () => capture.current!.state);
  const recording = program.kind === "recording";
  const capturing =
    program.kind === "starting" ||
    recording ||
    program.kind === "stopping" ||
    program.kind === "saving";
  const uploading = program.kind === "saving" && program.cloud;
  const take = program.kind === "retained" || program.kind === "importing" ? program.take : null;
  const markCount = recording ? program.marks : 0;
  const captureFailure =
    program.kind === "failed"
      ? program.message
      : "failure" in program
        ? program.failure
        : undefined;
  const captureNotice = "notice" in program ? program.notice : undefined;
  // Upload progress only means something while a cloud take is in flight.
  const shownProgress = capturing ? progress : null;
  const blocked = snapshot.readOnly || snapshot.busy || snapshot.project.id !== projectID;

  // Takes on disk can be recovered later, so only takes held in memory keep Studio open.
  const busy = captureNeedsResolution(program) || clipsNeedResolution(clipState);
  useEffect(() => {
    onBusy(busy);
    if (!busy) return;
    const leave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [busy, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);
  const uploadedId = program.kind === "uploaded" ? program.mediaId : null;
  useEffect(() => {
    if (!uploadedId) return;
    setStatus("Saved to the cloud. Opening it in the editor…");
    void navigate({ to: "/edit/$mediaId", params: { mediaId: uploadedId } });
  }, [uploadedId, navigate]);
  useEffect(() => {
    let alive = true;
    // Anything on disk at startup was left by an earlier visit: stopped but not added, or cut off.
    void pruneTakes()
      .then(listTakes)
      .then((takes) => {
        if (alive) setRecovered(takes.filter((item) => !item.mediaId));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const attempt = useCallback(async (action: () => unknown, fallback: string) => {
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(message(cause, fallback));
    }
  }, []);
  const commit = useCallback(() => {
    refresh();
    const current = studio.current;
    if (!current) return;
    persist.current = persist.current
      .then(() => saveStudio(projectID, current))
      .catch(() => setError("Scene changes could not be saved on this device."));
  }, [projectID, refresh]);
  const ensureMixer = useCallback(async () => {
    mixer.current ??= new LiveAudioMixer(new AudioContext());
    await mixer.current.resume();
    return mixer.current;
  }, []);

  // Program output: loads saved scenes, then paints the active one while the panel is open.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const readers = new Map<string, Promise<LocalMediaReader>>();
    const reader = (id: string) => {
      let entry = readers.get(id);
      if (!entry) {
        entry = (async () => {
          const media = session.getSnapshot().project.media.find((item) => item.id === id);
          const local = await session.resource(id);
          if (!media || local?.state !== "available")
            throw new Error("Scene media is unavailable.");
          return LocalMediaReader.open(local.file, media.kind, 1280);
        })();
        readers.set(id, entry);
        entry.catch(() => readers.delete(id));
      }
      return entry;
    };
    void loadStudio(projectID)
      .then((loaded) => {
        if (!alive || !canvas.current) return;
        studio.current = loaded;
        output.current = new LiveStudioOutput(
          canvas.current,
          loaded,
          reader,
          undefined,
          (context) => paintSources(context, sources.current),
          // Real-time software compositing and VP8 encoding cannot sustain a 4K project canvas.
          1080,
        );
        setSelected(loaded.activeScene?.id ?? loaded.list()[0]?.id ?? null);
        setName(`Scene ${loaded.list().length + 1}`);
        const origin = performance.now();
        // An interval, not rAF: a backgrounded window must keep feeding an active recording.
        timer = setInterval(() => {
          if (!loaded.activeScene) return;
          output.current
            ?.render((performance.now() - origin) / 1000)
            .then((painted) => {
              if (alive && painted) setFrame(painted.sceneId);
            })
            .catch((cause: unknown) => {
              if (alive) setError(message(cause, "The scene could not be rendered."));
            });
        }, 1000 / liveQualityProfiles.standard.framesPerSecond);
      })
      .catch((cause: unknown) => {
        if (alive) setError(`Saved scenes could not be opened. ${message(cause, "")}`.trim());
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
      clearInterval(timer);
      void clips.current?.close();
      capture.current?.close();
      output.current?.close();
      output.current = null;
      for (const source of [...sources.current, ...audioInputs.current])
        for (const track of source.stream.getTracks()) track.stop();
      sources.current = [];
      audioInputs.current = [];
      mixer.current?.close();
      void mixer.current?.context.close();
      mixer.current = null;
      for (const entry of readers.values()) void entry.then((item) => item.close()).catch(() => {});
    };
  }, [projectID, session]);

  const inputCount = audioInputs.current.length;
  useEffect(() => {
    if (!inputCount) return;
    const timer = setInterval(() => {
      setMeters(
        Object.fromEntries(
          audioInputs.current.map((input) => [input.id, input.channel.meter().peak]),
        ),
      );
    }, 150);
    return () => clearInterval(timer);
  }, [inputCount]);

  // The look editor always starts from what the selected scene actually saved.
  useEffect(() => {
    if (!selected || !studio.current) return;
    try {
      setDraft(liveAssets(studio.current.project(selected).liveAssets ?? DEFAULT_LIVE_ASSETS));
    } catch {
      setDraft(DEFAULT_LIVE_ASSETS);
    }
  }, [selected]);

  const scenes = studio.current?.list() ?? [];
  const active = studio.current?.activeScene ?? null;
  const selectedScene = scenes.find((scene) => scene.id === selected);

  const saveFromEditor = (existing?: { id: string; name: string }) =>
    attempt(() => {
      const current = studio.current;
      if (!current) return;
      const id = existing?.id ?? crypto.randomUUID();
      const look = existing ? current.project(existing.id).liveAssets : undefined;
      current.save({
        id,
        name: existing?.name ?? name,
        project: { ...session.getSnapshot().project, liveAssets: look ?? DEFAULT_LIVE_ASSETS },
        expectedRevision: current.currentRevision,
      });
      setSelected(id);
      if (!existing) setName(`Scene ${current.list().length + 1}`);
      commit();
    }, "The scene could not be saved.");
  const switchTo = (id: string) =>
    attempt(() => {
      const current = studio.current;
      if (!current) return;
      current.switch({ id, expectedRevision: current.currentRevision });
      setSelected(id);
      commit();
    }, "The scene could not be switched.");
  const remove = (id: string) =>
    attempt(() => {
      const current = studio.current;
      if (!current) return;
      current.remove({ id, expectedRevision: current.currentRevision });
      if (selected === id) setSelected(current.activeScene?.id ?? current.list()[0]?.id ?? null);
      commit();
    }, "The scene could not be removed.");
  const applyLook = (goLive: boolean) =>
    attempt(() => {
      const current = studio.current;
      if (!current || !selectedScene) return;
      current.save({
        id: selectedScene.id,
        name: selectedScene.name,
        project: { ...current.project(selectedScene.id), liveAssets: liveAssets(draft) },
        expectedRevision: current.currentRevision,
      });
      if (goLive)
        current.switch({ id: selectedScene.id, expectedRevision: current.currentRevision });
      commit();
    }, "The look could not be applied.");
  const addOverlay = () => {
    const text = overlayText.trim();
    if (!text) return;
    setDraft((current) => ({
      ...current,
      overlays: [
        ...current.overlays,
        {
          id: crypto.randomUUID(),
          kind: overlayKind,
          text,
          ...OVERLAY_BOUNDS[overlayKind],
          color: current.accent,
          textColor: "#ffffff",
          opacity: 1,
          enabled: true,
          motion: "none",
          start: 0,
          duration: 86400,
        },
      ],
    }));
    setOverlayText("");
  };

  const removeSource = (id: string) => {
    const source = sources.current.find((item) => item.id === id);
    if (!source) return;
    sources.current = sources.current.filter((item) => item.id !== id);
    for (const track of source.stream.getTracks()) track.stop();
    source.video.srcObject = null;
    setSelectedSource((current) => (current === id ? null : current));
    refresh();
  };
  const addSource = (kind: VideoSource["kind"]) =>
    attempt(async () => {
      const stream =
        kind === "camera"
          ? await navigator.mediaDevices.getUserMedia({ video: true })
          : await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      const id = crypto.randomUUID();
      try {
        await video.play();
      } catch (cause) {
        for (const track of stream.getTracks()) track.stop();
        throw cause;
      }
      const same = sources.current.filter((item) => item.kind === kind);
      const label = `${kind === "camera" ? "Camera" : "Screen"} ${++sourceNumbers.current[kind]}`;
      const layout = defaultLayout(kind, same.length, canvasAspect(), sourceAspect(video));
      const source: VideoSource = { id, kind, label, layout, video, stream };
      // New screens go under the cameras so a share never hides the presenter.
      const firstCamera = sources.current.findIndex((item) => item.kind === "camera");
      const at = kind === "screen" && firstCamera >= 0 ? firstCamera : sources.current.length;
      sources.current = [...sources.current.slice(0, at), source, ...sources.current.slice(at)];
      stream.getVideoTracks()[0]?.addEventListener("ended", () => removeSource(id), { once: true });
      setSelectedSource(id);
      refresh();
    }, `Could not start the ${kind}.`);
  const placeSource = (id: string, layout: SourceLayout) => {
    const source = sources.current.find((item) => item.id === id);
    if (!source) return;
    source.layout = layout;
    refresh();
  };
  /** Moves a source one layer up (towards the viewer) or down. */
  const restack = (id: string, step: 1 | -1) => {
    const from = sources.current.findIndex((item) => item.id === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= sources.current.length) return;
    const next = [...sources.current];
    [next[from], next[to]] = [next[to]!, next[from]!];
    sources.current = next;
    refresh();
  };
  const removeInput = (id: string) => {
    mixer.current?.remove(id);
    for (const input of audioInputs.current)
      if (input.id === id) for (const track of input.stream.getTracks()) track.stop();
    audioInputs.current = audioInputs.current.filter((input) => input.id !== id);
    refresh();
  };
  const addMicrophone = () =>
    attempt(async () => {
      const audio = await ensureMixer();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const id = crypto.randomUUID();
      const track = stream.getAudioTracks()[0];
      const channel = audio.addStream(id, stream, DEFAULT_LIVE_AUDIO);
      track?.addEventListener("ended", () => removeInput(id), { once: true });
      setSettings((current) => ({ ...current, [id]: DEFAULT_LIVE_AUDIO }));
      audioInputs.current = [
        ...audioInputs.current,
        {
          id,
          label: track?.label || `Microphone ${audioInputs.current.length + 1}`,
          stream,
          channel,
        },
      ];
      refresh();
    }, "Could not start the microphone.");
  const updateInput = (input: AudioInput, change: Partial<LiveAudioSettings>) => {
    const next = { ...(settings[input.id] ?? DEFAULT_LIVE_AUDIO), ...change };
    void attempt(() => {
      input.channel.update(next);
      setSettings((current) => ({ ...current, [input.id]: next }));
    }, "The audio setting could not be changed.");
  };
  const loadSound = (file: File | undefined) =>
    attempt(async () => {
      if (!file) return;
      if (file.size > 32 * 1024 * 1024) throw new Error("Soundboard files can be up to 32 MiB.");
      const audio = await ensureMixer();
      sounds.current.set(file.name, await audio.context.decodeAudioData(await file.arrayBuffer()));
      refresh();
    }, "That sound could not be decoded.");
  const playSound = (soundName: string) =>
    attempt(async () => {
      const audio = await ensureMixer();
      const buffer = sounds.current.get(soundName);
      if (buffer) audio.play(`sound-${crypto.randomUUID()}`, buffer);
    }, "The sound could not be played.");

  const programStream = async () => {
    const audio = await ensureMixer();
    if (!output.current) throw new Error("Studio output is unavailable.");
    return { stream: output.current.recordingStream(audio.stream), audio: audio.stream };
  };
  latestStream.current = programStream;

  latestSink.current = (fileName, report) =>
    openTakeSink(
      fileName,
      "video/webm",
      {
        // Takes stream to disk. Browsers that cannot do that keep a capped copy in memory instead.
        createWriter: (target) => TakeWriter.create(target),
        beginCloud:
          toCloud && cloud.state === "ready"
            ? (target, marks) => {
                setProgress({ sentBytes: 0, recordedBytes: 0, parts: 0 });
                return cloud.begin(target, "video/webm", marks, setProgress);
              }
            : null,
        limitBytes: recordingLimits.bytes,
        createURL: (file) => URL.createObjectURL(file),
        // The disk copy lets the editor open the take without downloading it again.
        linkUpload: (info, mediaId) => updateTake({ ...info, mediaId }),
      },
      report,
    );
  const startRecording = () =>
    attempt(async () => {
      setStatus("");
      await capture.current!.start();
    }, "Recording could not start.");
  const addClip = (file: File) =>
    attempt(async () => {
      await clips.current!.importClip((target) => session.importFiles([target]).then(() => {}));
      setStatus(`${file.name} was added to Project media.`);
    }, "Import failed. Download the file or retry.");
  const addTake = (takeName: string) =>
    attempt(async () => {
      let where: Awaited<ReturnType<typeof addTakeToProject>> | undefined;
      await capture.current!.importTake(async (target) => {
        where = await addTakeToProject(session, target.file, target.marks);
      });
      if (where) setStatus(placedMessage(takeName, where));
    }, "Import failed. Download the file or retry.");
  const dropRecovered = (fileName: string) => {
    void removeTake(fileName);
    setRecovered((items) => items.filter((item) => item.fileName !== fileName));
  };
  const downloadRecovered = (fileName: string) =>
    attempt(async () => {
      const url = URL.createObjectURL(await takeFile(fileName));
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }, "The take could not be read from this device.");
  const toggleClips = () =>
    attempt(async () => {
      if (armed || clipState.buffer.kind === "failed") await clips.current!.disarm();
      else await clips.current!.arm();
    }, "Recent clips could not start.");
  const saveClip = (seconds: 30 | 60) =>
    attempt(() => clips.current!.save(seconds), "The clip could not be saved.");

  const stageSources = sources.current.map((source) => ({
    id: source.id,
    label: source.label,
    layout: source.layout,
    aspect: sourceAspect(source.video),
  }));
  const startDisabled =
    !frame || (program.kind !== "idle" && program.kind !== "failed" && program.kind !== "uploaded");

  return (
    <div className="studio-layout">
      <div className="grid gap-3">
        <div className="studio-program-frame">
          <div
            className="studio-program"
            style={{ ["--studio-aspect" as string]: String(canvasAspect()) }}
            data-recording={recording || undefined}
          >
            <canvas ref={canvas} aria-label="Program output" data-scene={frame ?? ""} />
            {frame && (
              <SourceStage
                sources={stageSources}
                canvasAspect={canvasAspect()}
                selected={selectedSource}
                onSelect={setSelectedSource}
                onChange={placeSource}
              />
            )}
            {!active && !loading && (
              <p className="studio-program-empty">
                Save a scene from the editor, then go live with it to start the program output.
              </p>
            )}
            {recording && (
              <span className="studio-rec-badge" aria-hidden>
                REC
              </span>
            )}
          </div>
        </div>
        {(error || captureFailure) && (
          <p role="alert" className="studio-alert">
            {error || captureFailure}
          </p>
        )}
        <p role="status" aria-live="polite" className="text-muted-foreground empty:hidden">
          {loading ? "Opening saved scenes…" : status || captureNotice}
        </p>
        <Section title="Go">
          <div role="radiogroup" aria-label="Output" className="studio-modes">
            {(
              [
                ["record", "Record"],
                ["live", "Live"],
                ["both", "Both"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} data-checked={mode === value || undefined}>
                <input
                  type="radio"
                  name="studio-mode"
                  className="sr-only"
                  value={value}
                  checked={mode === value}
                  disabled={busy}
                  onChange={() => setMode(value)}
                />
                {label}
                {value !== "record" && !canStream && <small>Desktop app</small>}
              </label>
            ))}
          </div>
          {mode !== "record" &&
            (canStream ? (
              <>
                <p className="text-muted-foreground">
                  The desktop app streams to RTMP and keeps a recording on this computer. Studio
                  scenes are not streamed yet: it captures the screen or camera you pick below.
                </p>
                <NativeRecordingControls />
              </>
            ) : (
              <p className="text-muted-foreground">
                Going live needs the raE.E desktop app. In the browser you can record the program.
              </p>
            ))}
          {mode === "record" && (
            <>
              <div className="studio-go-row">
                {recording ? (
                  <Button
                    variant="destructive"
                    className="studio-go-button"
                    onClick={() => capture.current!.stop()}
                  >
                    <RiStopFill data-icon="inline-start" />
                    Stop recording
                  </Button>
                ) : (
                  <Button
                    className="studio-go-button"
                    disabled={startDisabled}
                    onClick={() => void startRecording()}
                  >
                    <RiRecordCircleFill data-icon="inline-start" className="text-red-500" />
                    Start recording
                  </Button>
                )}
                {recording && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void attempt(() => capture.current!.mark(), "The mark could not be added.")
                    }
                  >
                    <RiFlagLine data-icon="inline-start" />
                    Mark moment
                  </Button>
                )}
                <label className="studio-save-to">
                  <span>Save to</span>
                  <select
                    value={toCloud ? "cloud" : "device"}
                    disabled={busy}
                    onChange={(event) =>
                      setSaveTo(event.target.value === "cloud" ? "cloud" : "device")
                    }
                  >
                    <option value="device">This device</option>
                    <option value="cloud" disabled={cloud.state !== "ready"}>
                      {cloud.state === "ready" ? `Cloud · ${cloud.teamName}` : "Cloud"}
                    </option>
                  </select>
                </label>
              </div>
              <p className="text-muted-foreground">
                {recording ? (
                  <span role="status">
                    Recording program output…
                    {markCount ? ` ${markCount} ${markCount === 1 ? "mark" : "marks"}` : ""}
                  </span>
                ) : program.kind === "starting" ? (
                  <span role="status">Starting recording…</span>
                ) : program.kind === "stopping" || (program.kind === "saving" && !program.cloud) ? (
                  <span role="status">Saving the take…</span>
                ) : !frame ? (
                  "Go live with a scene to enable recording."
                ) : cloud.state !== "ready" ? (
                  cloud.reason
                ) : toCloud ? (
                  "Uploads while you record. When you stop, the take opens in the editor."
                ) : (
                  "Takes stay in this browser until you add them to the project or download them."
                )}
              </p>
              {shownProgress && (
                <p role="status">
                  {uploading ? "Finishing upload:" : "Uploaded"}{" "}
                  {megabytes(shownProgress.sentBytes)} of {megabytes(shownProgress.recordedBytes)}{" "}
                  recorded
                </p>
              )}
              {take && (
                <div className="studio-item">
                  <span className="min-w-0 flex-1 truncate">{take.file.name}</span>
                  <Button
                    size="sm"
                    disabled={blocked || program.kind === "importing"}
                    onClick={() => void addTake(take.file.name)}
                  >
                    Add take to project
                  </Button>
                  <a
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    href={take.url}
                    download={take.file.name}
                  >
                    Download take
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={program.kind === "importing"}
                    onClick={() => capture.current!.discard()}
                  >
                    Discard take
                  </Button>
                </div>
              )}
            </>
          )}
        </Section>
        {recovered.length > 0 && (
          <Section
            title="Recovered takes"
            description="Takes left on this device by an earlier visit. Interrupted takes may end abruptly."
          >
            <ul className="grid gap-1.5">
              {recovered.map((item) => (
                <li key={item.fileName} className="studio-item">
                  <span className="min-w-0 flex-1 truncate">
                    {new Date(item.startedAt).toLocaleString()} · {megabytes(item.bytes)}
                    {item.state === "recording" ? " · interrupted" : ""}
                  </span>
                  <Button
                    size="sm"
                    disabled={blocked}
                    onClick={() =>
                      void attempt(async () => {
                        const file = await takeFile(item.fileName);
                        const where = await addTakeToProject(session, file, item.marks);
                        dropRecovered(item.fileName);
                        setStatus(placedMessage(file.name, where));
                      }, "The take could not be added. Download it or retry.")
                    }
                  >
                    Add to project
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void downloadRecovered(item.fileName)}
                  >
                    Download
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => dropRecovered(item.fileName)}>
                    Discard
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <Section
          title="Recent clips"
          description="Keep a rolling buffer of the program and save the last 30 or 60 seconds."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={armed ? "secondary" : "outline"}
              disabled={
                !frame ||
                clipState.buffer.kind === "arming" ||
                clipState.buffer.kind === "stopping" ||
                saving
              }
              onClick={() => void toggleClips()}
            >
              {armed ? "Stop buffer" : "Arm buffer"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!armed}
              onClick={() =>
                void attempt(
                  () => clips.current!.mark("Studio mark"),
                  "The mark could not be added.",
                )
              }
            >
              Add mark
            </Button>
            {([30, 60] as const).map((seconds) => (
              <Button
                key={seconds}
                size="sm"
                variant="outline"
                disabled={!armed || saving || clipState.product.kind === "importing"}
                onClick={() => void saveClip(seconds)}
              >
                Save last {seconds}s
              </Button>
            ))}
          </div>
          {clip && (
            <div className="studio-item">
              <span className="min-w-0 flex-1 truncate">
                {clip.file.name} · {clip.marks} {clip.marks === 1 ? "mark" : "marks"}
              </span>
              <Button
                size="sm"
                disabled={blocked || clipState.product.kind === "importing"}
                onClick={() => void addClip(clip.file)}
              >
                Add clip to project
              </Button>
              <a
                className={buttonVariants({ size: "sm", variant: "outline" })}
                href={clip.url}
                download={clip.file.name}
              >
                Download clip
              </a>
              <Button
                size="sm"
                variant="ghost"
                disabled={clipState.product.kind === "importing"}
                onClick={() => clips.current!.discard()}
              >
                Discard clip
              </Button>
            </div>
          )}
        </Section>
      </div>
      <div className="grid gap-3">
        <Section
          title="Scenes"
          description="Pick a scene to edit its look. Go live puts it on the program."
        >
          {scenes.length > 0 && (
            <ul className="studio-list">
              {scenes.map((scene) => {
                const live = active?.id === scene.id;
                return (
                  <li
                    key={scene.id}
                    className="studio-row"
                    data-selected={selected === scene.id || undefined}
                  >
                    <label className="studio-row-main">
                      <input
                        type="radio"
                        name="studio-scene"
                        className="sr-only"
                        checked={selected === scene.id}
                        onChange={() => setSelected(scene.id)}
                      />
                      <span className="truncate">{scene.name}</span>
                      {live && <span className="studio-live-badge">Live</span>}
                    </label>
                    {!live && (
                      <Button
                        size="xs"
                        aria-label={`Switch to ${scene.name}`}
                        onClick={() => void switchTo(scene.id)}
                      >
                        Go live
                      </Button>
                    )}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Update ${scene.name} from editor`}
                      title="Update from editor"
                      onClick={() => void saveFromEditor({ id: scene.id, name: scene.name })}
                    >
                      <RiRefreshLine />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${scene.name}`}
                      title={live ? "Go live with another scene first" : "Remove scene"}
                      disabled={live}
                      onClick={() => void remove(scene.id)}
                    >
                      <RiDeleteBinLine />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!loading && name.trim()) void saveFromEditor();
            }}
          >
            <Input
              aria-label="New scene name"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" disabled={loading || !name.trim()}>
              <RiAddLine data-icon="inline-start" />
              Save from editor
            </Button>
          </form>
        </Section>
        <Section
          title="Sources"
          description={
            sources.current.length
              ? "Drag a source on the preview to move it, or drag its corners to resize. Hold Alt to stop snapping."
              : "Add a camera or share a screen to put it on the program."
          }
          action={
            <>
              <Button size="sm" variant="outline" onClick={() => void addSource("camera")}>
                <RiVideoOnLine data-icon="inline-start" />
                Add camera
              </Button>
              <Button size="sm" variant="outline" onClick={() => void addSource("screen")}>
                <RiComputerLine data-icon="inline-start" />
                Add screen
              </Button>
            </>
          }
        >
          {sources.current.length > 0 && (
            <ul className="studio-list">
              {/* Top layer first, like a layers panel. */}
              {[...sources.current].reverse().map((source, fromTop, list) => {
                const isSelected = selectedSource === source.id;
                const aspects = [canvasAspect(), sourceAspect(source.video)] as const;
                return (
                  <li
                    key={source.id}
                    className="studio-row"
                    data-selected={isSelected || undefined}
                  >
                    <button
                      type="button"
                      className="studio-row-main"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedSource(isSelected ? null : source.id)}
                    >
                      {source.kind === "camera" ? <RiVideoOnLine /> : <RiComputerLine />}
                      <span className="truncate">{source.label}</span>
                    </button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Fit ${source.label} to the frame`}
                      title="Fit to frame"
                      onClick={() => placeSource(source.id, fitLayout(...aspects))}
                    >
                      <RiFullscreenExitLine />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Fill the frame with ${source.label}`}
                      title="Fill frame"
                      onClick={() => placeSource(source.id, fillLayout(...aspects))}
                    >
                      <RiFullscreenLine />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Bring ${source.label} forward`}
                      title="Bring forward"
                      disabled={fromTop === 0}
                      onClick={() => restack(source.id, 1)}
                    >
                      <RiArrowUpLine />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Send ${source.label} backward`}
                      title="Send backward"
                      disabled={fromTop === list.length - 1}
                      onClick={() => restack(source.id, -1)}
                    >
                      <RiArrowDownLine />
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${source.label}`}
                      title="Remove source"
                      onClick={() => removeSource(source.id)}
                    >
                      <RiCloseLine />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <Section
          title="Scene look"
          description={
            selectedScene ? (
              <>
                Editing <strong className="text-foreground">{selectedScene.name}</strong>
              </>
            ) : (
              "Save a scene to style it."
            )
          }
        >
          <div className="studio-fields">
            <label className="studio-field">
              <span>Background</span>
              <select
                value={draft.background}
                disabled={!selectedScene}
                onChange={(event) => {
                  const background = LIVE_BACKGROUNDS.find((item) => item === event.target.value);
                  if (background) setDraft((current) => ({ ...current, background }));
                }}
              >
                {LIVE_BACKGROUNDS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="studio-field">
              <span>Color</span>
              <input
                type="color"
                value={draft.color}
                disabled={!selectedScene}
                onChange={(event) => setDraft({ ...draft, color: event.target.value })}
              />
            </label>
            <label className="studio-field">
              <span>Accent</span>
              <input
                type="color"
                value={draft.accent}
                disabled={!selectedScene}
                onChange={(event) => setDraft({ ...draft, accent: event.target.value })}
              />
            </label>
            <label className="studio-check">
              <input
                type="checkbox"
                checked={draft.motion}
                disabled={!selectedScene}
                onChange={(event) => setDraft({ ...draft, motion: event.target.checked })}
              />
              Motion
            </label>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addOverlay();
            }}
          >
            <select
              aria-label="Overlay type"
              value={overlayKind}
              disabled={!selectedScene}
              className="w-28 shrink-0"
              onChange={(event) => {
                const kind = (["banner", "takeover", "highlight"] as const).find(
                  (item) => item === event.target.value,
                );
                if (kind) setOverlayKind(kind);
              }}
            >
              <option value="banner">Banner</option>
              <option value="takeover">Takeover</option>
              <option value="highlight">Highlight</option>
            </select>
            <Input
              aria-label="Overlay text"
              placeholder="Overlay text"
              value={overlayText}
              maxLength={500}
              disabled={!selectedScene}
              onChange={(event) => setOverlayText(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!selectedScene || !overlayText.trim() || draft.overlays.length >= 20}
            >
              Add
            </Button>
          </form>
          {draft.overlays.length > 0 && (
            <ul className="studio-list">
              {draft.overlays.map((overlay) => (
                <li key={overlay.id} className="studio-row">
                  <label className="studio-row-main">
                    <input
                      type="checkbox"
                      checked={overlay.enabled}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          overlays: draft.overlays.map((item) =>
                            item.id === overlay.id
                              ? { ...item, enabled: event.target.checked }
                              : item,
                          ),
                        })
                      }
                    />
                    <span className="text-muted-foreground capitalize">{overlay.kind}</span>
                    <span className="truncate">{overlay.text}</span>
                  </label>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove overlay ${overlay.text}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        overlays: draft.overlays.filter((item) => item.id !== overlay.id),
                      })
                    }
                  >
                    <RiCloseLine />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedScene}
              onClick={() => void applyLook(false)}
            >
              Save look
            </Button>
            <Button size="sm" disabled={!selectedScene} onClick={() => void applyLook(true)}>
              Save and go live
            </Button>
          </div>
        </Section>
        <Section
          title="Audio"
          description={
            audioInputs.current.length || sounds.current.size
              ? undefined
              : "Add a microphone for your voice, or sounds to play on cue."
          }
          action={
            <>
              <Button size="sm" variant="outline" onClick={() => void addMicrophone()}>
                <RiMicLine data-icon="inline-start" />
                Add microphone
              </Button>
              <label className={buttonVariants({ size: "sm", variant: "outline" })}>
                <RiMusic2Line data-icon="inline-start" />
                Add sound
                <input
                  className="sr-only"
                  type="file"
                  accept="audio/*"
                  onChange={(event) => {
                    void loadSound(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </label>
            </>
          }
        >
          {audioInputs.current.map((input) => {
            const value = settings[input.id] ?? DEFAULT_LIVE_AUDIO;
            return (
              <div key={input.id} className="studio-channel">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <RiMicLine className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{input.label}</span>
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Remove ${input.label}`}
                    onClick={() => removeInput(input.id)}
                  >
                    <RiCloseLine />
                  </Button>
                </div>
                <meter
                  aria-label={`${input.label} level`}
                  min={0}
                  max={1}
                  low={0.6}
                  high={0.9}
                  optimum={0.3}
                  value={meters[input.id] ?? 0}
                />
                <label className="studio-slider">
                  <span>Gain</span>
                  <input
                    type="range"
                    min={-60}
                    max={12}
                    value={value.gainDB}
                    onChange={(event) => updateInput(input, { gainDB: Number(event.target.value) })}
                  />
                  <output>{value.gainDB} dB</output>
                </label>
                <label className="studio-slider">
                  <span>Delay</span>
                  <input
                    type="range"
                    min={0}
                    max={500}
                    step={10}
                    value={value.syncOffsetMs}
                    onChange={(event) =>
                      updateInput(input, { syncOffsetMs: Number(event.target.value) })
                    }
                  />
                  <output>{value.syncOffsetMs} ms</output>
                </label>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <label className="studio-check">
                    <input
                      type="checkbox"
                      checked={value.muted}
                      onChange={(event) => updateInput(input, { muted: event.target.checked })}
                    />
                    Mute
                  </label>
                  <label className="studio-check">
                    <input
                      type="checkbox"
                      checked={value.monitor}
                      onChange={(event) => updateInput(input, { monitor: event.target.checked })}
                    />
                    Monitor
                  </label>
                  <label className="studio-check">
                    <input
                      type="checkbox"
                      checked={value.cleanup === "rumble"}
                      onChange={(event) =>
                        updateInput(input, { cleanup: event.target.checked ? "rumble" : "off" })
                      }
                    />
                    Remove rumble
                  </label>
                </div>
              </div>
            );
          })}
          {sounds.current.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {[...sounds.current.keys()].map((sound) => (
                <Button
                  key={sound}
                  size="sm"
                  variant="secondary"
                  onClick={() => void playSound(sound)}
                >
                  <RiPlayFill data-icon="inline-start" />
                  {sound}
                </Button>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
