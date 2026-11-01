import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { useEditorSession } from "@/modules/workspace/editor-session";
import { loadStudio, saveStudio } from "./studio-store";
import "./studio.css";

type VideoSource = {
  id: string;
  kind: "camera" | "screen";
  video: HTMLVideoElement;
  stream: MediaStream;
};
type AudioInput = { id: string; label: string; stream: MediaStream; channel: LiveAudioChannel };
type Take = { file: File; url: string };
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

/** Draw whole sources; screens fill the frame and cameras sit picture-in-picture above them. */
function paintSources(context: CanvasRenderingContext2D, sources: readonly VideoSource[]) {
  const { width, height } = context.canvas;
  const ordered = [...sources].sort(
    (a, b) => Number(a.kind === "camera") - Number(b.kind === "camera"),
  );
  let cameras = 0;
  for (const { kind, video } of ordered) {
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) continue;
    if (kind === "screen") {
      const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      context.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
    } else {
      const w = width * 0.25;
      const h = w / (video.videoWidth / video.videoHeight);
      const margin = width * 0.02;
      context.drawImage(video, width - w - margin, height - (h + margin) * ++cameras, w, h);
    }
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2 rounded-lg border p-3" aria-label={title}>
      <h3 className="font-medium">{title}</h3>
      {children}
    </section>
  );
}

export default function StudioPanel({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const { session, snapshot } = useEditorSession();
  const projectID = useRef(snapshot.project.id).current;
  const canvas = useRef<HTMLCanvasElement>(null);
  const studio = useRef<LiveStudio | null>(null);
  const output = useRef<LiveStudioOutput | null>(null);
  const mixer = useRef<LiveAudioMixer | null>(null);
  const sources = useRef<VideoSource[]>([]);
  const audioInputs = useRef<AudioInput[]>([]);
  const clips = useRef(new RecentClips());
  const recorder = useRef<MediaRecorder | null>(null);
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
  const [overlayText, setOverlayText] = useState("");
  const [overlayKind, setOverlayKind] = useState<LiveOverlay["kind"]>("banner");
  const [settings, setSettings] = useState<Record<string, LiveAudioSettings>>({});
  const [meters, setMeters] = useState<Record<string, number>>({});
  const [recording, setRecording] = useState(false);
  const [take, setTake] = useState<Take | null>(null);
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [clip, setClip] = useState<(Take & { marks: number }) | null>(null);
  const blocked = snapshot.readOnly || snapshot.busy || snapshot.project.id !== projectID;
  const hasTake = Boolean(take || clip);

  useEffect(() => {
    onBusy(recording || hasTake);
    if (!recording && !hasTake) return;
    const leave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [hasTake, onBusy, recording]);
  useEffect(() => () => onBusy(false), [onBusy]);

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
    const clipBuffer = clips.current;
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
      void clipBuffer.stop();
      if (recorder.current?.state === "recording") recorder.current.stop();
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
      sources.current = [...sources.current, { id, kind, video, stream }];
      stream.getVideoTracks()[0]?.addEventListener("ended", () => removeSource(id), { once: true });
      refresh();
    }, `Could not start the ${kind}.`);
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
  const startRecording = () =>
    attempt(async () => {
      const { stream } = await programStream();
      const profile = liveQualityProfiles.standard;
      const next = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp8,opus",
        videoBitsPerSecond: profile.videoBitsPerSecond,
        audioBitsPerSecond: profile.audioBitsPerSecond,
      });
      const chunks: Blob[] = [];
      let bytes = 0;
      next.ondataavailable = (event) => {
        if (!event.data.size) return;
        chunks.push(event.data);
        bytes += event.data.size;
        if (bytes >= recordingLimits.bytes && next.state === "recording") {
          setStatus("Recording reached the 128 MiB limit and stopped.");
          next.stop();
        }
      };
      next.onerror = () => setError("The recording encoder failed. Add or discard this take.");
      next.onstop = () => {
        recorder.current = null;
        setRecording(false);
        if (!chunks.length) return;
        const file = new File(chunks, `studio-${Date.now()}.webm`, { type: "video/webm" });
        setTake({ file, url: URL.createObjectURL(file) });
      };
      recorder.current = next;
      next.start(1000);
      setStatus("");
      setRecording(true);
    }, "Recording could not start.");
  const addFile = (file: File, done: () => void) =>
    attempt(async () => {
      await session.importFiles([file]);
      done();
      setStatus(`${file.name} was added to Project media.`);
    }, "Import failed. Download the file or retry.");
  const clearTake = () => {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
  };
  const clearClip = () => {
    if (clip) URL.revokeObjectURL(clip.url);
    setClip(null);
  };
  const toggleClips = () =>
    attempt(async () => {
      if (armed) {
        await clips.current.stop();
        setArmed(false);
        return;
      }
      const { stream, audio } = await programStream();
      clips.current.arm({ video: stream, audio });
      setArmed(true);
    }, "Recent clips could not start.");
  const saveClip = (seconds: 30 | 60) =>
    attempt(async () => {
      setSaving(true);
      try {
        const saved = await clips.current.save(seconds);
        if (clip) URL.revokeObjectURL(clip.url);
        setClip({
          file: saved.file,
          url: URL.createObjectURL(saved.file),
          marks: saved.marks.length,
        });
      } finally {
        setSaving(false);
      }
    }, "The clip could not be saved.");

  return (
    <div className="studio-layout">
      <div className="grid gap-3">
        <div className="studio-program">
          <canvas ref={canvas} aria-label="Program output" data-scene={frame ?? ""} />
          {!active && !loading && <p>Save a scene and switch to it to start the program output.</p>}
        </div>
        {error && <p role="alert">{error}</p>}
        <p role="status" aria-live="polite" className="empty:hidden">
          {loading ? "Opening saved scenes…" : status}
        </p>
        <Section title="Record program">
          <div className="flex flex-wrap items-center gap-2">
            {recording ? (
              <Button size="sm" onClick={() => recorder.current?.stop()}>
                Stop recording
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!frame || Boolean(take)}
                onClick={() => void startRecording()}
              >
                Start recording
              </Button>
            )}
            {recording && <span role="status">Recording program output…</span>}
          </div>
          {take && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate">{take.file.name}</span>
              <Button
                size="sm"
                disabled={blocked}
                onClick={() => void addFile(take.file, clearTake)}
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
              <Button size="sm" variant="outline" onClick={clearTake}>
                Discard take
              </Button>
            </div>
          )}
        </Section>
        <Section title="Recent clips">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!frame}
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
                  () => clips.current.mark("Studio mark"),
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
                disabled={!armed || saving}
                onClick={() => void saveClip(seconds)}
              >
                Save last {seconds}s
              </Button>
            ))}
          </div>
          {clip && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate">
                {clip.file.name} · {clip.marks} {clip.marks === 1 ? "mark" : "marks"}
              </span>
              <Button
                size="sm"
                disabled={blocked}
                onClick={() => void addFile(clip.file, clearClip)}
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
              <Button size="sm" variant="outline" onClick={clearClip}>
                Discard clip
              </Button>
            </div>
          )}
        </Section>
      </div>
      <div className="grid gap-3">
        <Section title="Scenes">
          <div className="flex gap-2">
            <Input
              aria-label="New scene name"
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
            <Button
              size="sm"
              disabled={loading || !name.trim()}
              onClick={() => void saveFromEditor()}
            >
              Save from editor
            </Button>
          </div>
          <ul className="grid gap-1">
            {scenes.map((scene) => (
              <li key={scene.id} className="flex flex-wrap items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="radio"
                    name="studio-scene"
                    checked={selected === scene.id}
                    onChange={() => setSelected(scene.id)}
                  />
                  <span className="truncate">{scene.name}</span>
                  {active?.id === scene.id && <strong>Live</strong>}
                </label>
                <Button
                  size="sm"
                  aria-label={`Switch to ${scene.name}`}
                  onClick={() => void switchTo(scene.id)}
                >
                  Switch
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Update ${scene.name} from editor`}
                  onClick={() => void saveFromEditor({ id: scene.id, name: scene.name })}
                >
                  Update
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Remove ${scene.name}`}
                  disabled={active?.id === scene.id}
                  onClick={() => void remove(scene.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Scene look">
          <label className="grid gap-1">
            Background
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
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2">
              Color
              <input
                type="color"
                value={draft.color}
                disabled={!selectedScene}
                onChange={(event) => setDraft({ ...draft, color: event.target.value })}
              />
            </label>
            <label className="flex items-center gap-2">
              Accent
              <input
                type="color"
                value={draft.accent}
                disabled={!selectedScene}
                onChange={(event) => setDraft({ ...draft, accent: event.target.value })}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.motion}
                disabled={!selectedScene}
                onChange={(event) => setDraft({ ...draft, motion: event.target.checked })}
              />
              Motion
            </label>
          </div>
          <div className="flex gap-2">
            <select
              aria-label="Overlay type"
              value={overlayKind}
              disabled={!selectedScene}
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
              value={overlayText}
              maxLength={500}
              disabled={!selectedScene}
              onChange={(event) => setOverlayText(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedScene || !overlayText.trim() || draft.overlays.length >= 20}
              onClick={addOverlay}
            >
              Add
            </Button>
          </div>
          <ul className="grid gap-1">
            {draft.overlays.map((overlay) => (
              <li key={overlay.id} className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2">
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
                  <span className="truncate">
                    {overlay.kind}: {overlay.text}
                  </span>
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Remove overlay ${overlay.text}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      overlays: draft.overlays.filter((item) => item.id !== overlay.id),
                    })
                  }
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedScene}
              onClick={() => void applyLook(false)}
            >
              Save look
            </Button>
            <Button size="sm" disabled={!selectedScene} onClick={() => void applyLook(true)}>
              Save and switch
            </Button>
          </div>
        </Section>
        <Section title="Sources">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void addSource("camera")}>
              Add camera
            </Button>
            <Button size="sm" variant="outline" onClick={() => void addSource("screen")}>
              Add screen
            </Button>
          </div>
          <ul className="grid gap-1">
            {sources.current.map((source, index) => (
              <li key={source.id} className="flex items-center justify-between gap-2">
                <span>
                  {source.kind === "camera" ? "Camera" : "Screen"} {index + 1}
                </span>
                <Button size="sm" variant="outline" onClick={() => removeSource(source.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Audio">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void addMicrophone()}>
              Add microphone
            </Button>
            <label className={buttonVariants({ size: "sm", variant: "outline" })}>
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
          </div>
          {audioInputs.current.map((input) => {
            const value = settings[input.id] ?? DEFAULT_LIVE_AUDIO;
            return (
              <div key={input.id} className="grid gap-1 rounded border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate">{input.label}</span>
                  <Button size="sm" variant="outline" onClick={() => removeInput(input.id)}>
                    Remove
                  </Button>
                </div>
                <meter
                  aria-label={`${input.label} level`}
                  min={0}
                  max={1}
                  value={meters[input.id] ?? 0}
                />
                <label className="flex items-center gap-2">
                  Gain
                  <input
                    type="range"
                    min={-60}
                    max={12}
                    value={value.gainDB}
                    onChange={(event) => updateInput(input, { gainDB: Number(event.target.value) })}
                  />
                  {value.gainDB} dB
                </label>
                <label className="flex items-center gap-2">
                  Delay
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
                  {value.syncOffsetMs} ms
                </label>
                <div className="flex flex-wrap gap-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={value.muted}
                      onChange={(event) => updateInput(input, { muted: event.target.checked })}
                    />
                    Mute
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={value.monitor}
                      onChange={(event) => updateInput(input, { monitor: event.target.checked })}
                    />
                    Monitor
                  </label>
                  <label className="flex items-center gap-2">
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
          <div className="flex flex-wrap gap-2">
            {[...sounds.current.keys()].map((sound) => (
              <Button key={sound} size="sm" variant="outline" onClick={() => void playSound(sound)}>
                Play {sound}
              </Button>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
