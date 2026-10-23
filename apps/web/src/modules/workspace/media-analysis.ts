import type { MediaItem } from "@sidecut/contracts/project";
import type { SourceSamples } from "@sidecut/platform-browser/source-analysis";
import type { PictureProxy } from "@sidecut/platform-browser/proxy";
import type { Transcript } from "@sidecut/core/transcript";
import type { SoundMatch } from "@sidecut/core/sound-sync";
import type { BrowserProjectSession } from "./browser-session";
import { pairTakes, decodeTakeSidecar } from "@sidecut/core/take-pairing";
import { derivedCache } from "@sidecut/platform-browser/derived-cache";
import { alignTranscript } from "@sidecut/core/speech";

export interface MediaAnalysisState {
  samples?: SourceSamples | undefined;
  proxy?: PictureProxy | undefined;
  proxyEnabled?: boolean;
  transcript?: Transcript | undefined;
  status?: string;
  error?: string | undefined;
}
export class MediaAnalysis {
  private state: Readonly<Record<string, MediaAnalysisState>> = {};
  private listeners = new Set<() => void>();
  private pending = new Map<string, Promise<unknown>>();
  private generation = 0;
  private aligned = new WeakMap<Transcript, { samples: SourceSamples; value: Transcript }>();
  constructor(private readonly session: BrowserProjectSession) {}
  /**
   * The transcript every speech query reads: word edges pulled to the cached waveform when it is
   * available, as the reference does on read. The stored transcript keeps the engine's times.
   */
  transcriptFor = (item: Pick<MediaItem, "id">): Transcript | undefined => {
    const state = this.state[item.id];
    if (!state?.transcript || !state.samples) return state?.transcript;
    const hit = this.aligned.get(state.transcript);
    if (hit?.samples === state.samples) return hit.value;
    const value = alignTranscript(
      state.transcript,
      state.samples.peaks,
      state.samples.peaksPerSecond,
    );
    this.aligned.set(state.transcript, { samples: state.samples, value });
    return value;
  };
  /** Loads cached transcripts and waveforms for every sound source available on this device. */
  async prepareSpeech() {
    const project = this.session.getSnapshot().project;
    const used = new Set(
      [...project.videoTracks, ...project.audioTracks].flatMap((track) =>
        track.clips.map(
          (clip) => (clip.content.media as { mediaID?: string } | undefined)?.mediaID,
        ),
      ),
    );
    await Promise.allSettled(
      project.media
        .filter((item) => item.hasAudio)
        .map(async (item) => {
          if ((await this.session.resource(item.id))?.state !== "available") return;
          await this.load(item.id);
          if (this.state[item.id]?.transcript && used.has(item.id)) await this.samples(item.id);
        }),
    );
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(id: string, patch: Partial<MediaAnalysisState>) {
    this.state = { ...this.state, [id]: { ...this.state[id], ...patch } };
    for (const listener of this.listeners) listener();
  }
  reset() {
    this.generation++;
    this.state = {};
    this.pending.clear();
    for (const listener of this.listeners) listener();
  }
  private async source(id: string) {
    const item = this.session.getSnapshot().project.media.find((m) => m.id === id),
      resource = await this.session.resource(id);
    if (!item || resource?.state !== "available")
      throw new Error("Import this source on this device before analysing it.");
    return { item, file: resource.file };
  }
  private run<T>(
    id: string,
    operation: string,
    task: (
      signal: AbortSignal,
      progress: (v: number) => void,
      source: { item: MediaItem; file: File },
    ) => Promise<T>,
    done: (value: T) => Partial<MediaAnalysisState>,
  ) {
    const key = `${operation}:${id}`,
      old = this.pending.get(key);
    if (old) return old as Promise<T>;
    const generation = this.generation;
    this.publish(id, { error: undefined, status: operation });
    const promise = this.session.jobs
      .run(
        key,
        `${operation}: ${this.session.getSnapshot().project.media.find((item) => item.id === id)?.path ?? id}`,
        20,
        new AbortController().signal,
        async (signal, progress) => {
          const source = await this.source(id);
          signal.throwIfAborted();
          const value = await task(signal, progress, source);
          signal.throwIfAborted();
          if (generation !== this.generation)
            throw new DOMException("Project changed.", "AbortError");
          this.publish(id, { status: "Ready", ...done(value) });
          return value;
        },
      )
      .catch((error: unknown) => {
        if (generation === this.generation)
          this.publish(id, {
            status: "Stopped",
            error: error instanceof Error ? error.message : String(error),
          });
        throw error;
      })
      .finally(() => {
        if (this.pending.get(key) === promise) this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }
  samples(id: string) {
    if (this.state[id]?.samples) return Promise.resolve(this.state[id]!.samples!);
    return this.run(
      id,
      "Timeline samples",
      async (signal, progress, { item, file }) => {
        const { sourceSamples } = await import("@sidecut/platform-browser/source-analysis");
        return sourceSamples(file, item, signal, progress);
      },
      (samples) => ({ samples }),
    );
  }
  generateProxy(id: string) {
    return this.run(
      id,
      "Generate proxy",
      async (signal, progress, { item, file }) => {
        const { generateProxy } = await import("@sidecut/platform-browser/proxy");
        return generateProxy(file, item, signal, progress);
      },
      (proxy) => ({ proxy }),
    );
  }
  async load(id: string) {
    const key = `load:${id}`;
    if (this.pending.has(key)) return this.pending.get(key);
    const generation = this.generation;
    const promise = (async () => {
      const { file } = await this.source(id);
      const [{ cachedProxy }, { cachedTranscript }] = await Promise.all([
        import("@sidecut/platform-browser/proxy"),
        import("@sidecut/platform-browser/transcription"),
      ]);
      const [proxy, transcript] = await Promise.all([cachedProxy(file), cachedTranscript(file)]);
      if (generation === this.generation)
        this.publish(id, {
          proxy: this.state[id]?.proxy ?? proxy,
          transcript: this.state[id]?.transcript ?? transcript,
        });
    })().finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    });
    this.pending.set(key, promise);
    return promise;
  }
  useProxy(id: string, enabled: boolean) {
    if (enabled && !this.state[id]?.proxy) throw new Error("Generate a proxy first.");
    this.publish(id, { proxyEnabled: enabled });
  }
  transcribe(id: string) {
    return this.run(
      id,
      "Local transcription",
      async (signal, progress, { item, file }) => {
        const { readMono } = await import("@sidecut/platform-browser/source-analysis");
        const { transcribeLocal, cachedTranscript } =
          await import("@sidecut/platform-browser/transcription");
        const existing = await cachedTranscript(file);
        signal.throwIfAborted();
        if (existing) return existing;
        const samples = await readMono(file, item, 16000, signal, (v) => progress(v * 0.1));
        const generation = this.generation;
        return transcribeLocal(
          file,
          samples,
          signal,
          (v) => progress(0.1 + v * 0.9),
          (status) => {
            if (generation === this.generation && !signal.aborted) this.publish(id, { status });
          },
        );
      },
      (transcript) => ({ transcript }),
    );
  }
  async identify(sidecarFile?: File) {
    const sidecars = new Map();
    if (sidecarFile) {
      if (sidecarFile.size > 1024 * 1024)
        throw new Error("Take sidecars must be smaller than 1 MiB.");
      sidecars.set(
        sidecarFile.name.toLowerCase(),
        decodeTakeSidecar(JSON.parse(await sidecarFile.text())),
      );
    }
    const { commands, notes } = pairTakes(this.session.getSnapshot().project.media, sidecars);
    if (!commands.length)
      throw new Error(
        notes.join(" ") ||
          "No unambiguous <base>-camera and <base>-screen pair found. Set take metadata manually.",
      );
    this.session.apply({ label: "Identify recorded takes", commands });
    for (const command of commands)
      this.publish(command.updateMedia.mediaID, { status: notes.join(" ") || "Take identified" });
  }
  align(id: string, referenceID: string) {
    const revision = this.session.getSnapshot().revision;
    return this.run(
      id,
      "Align by sound",
      async (signal, progress, { item, file }) => {
        const reference = await this.source(referenceID);
        if (referenceID === id) throw new Error("Choose a different reference source.");
        if (
          (item.duration?.seconds ?? Infinity) > 60 ||
          (reference.item.duration?.seconds ?? Infinity) > 60
        )
          throw new Error(
            "Browser sound sync supports recordings up to 60 seconds. Correct longer takes manually.",
          );
        const { audioIdentity } = await import("@sidecut/platform-browser/audio-analysis");
        const key = `sync:1:${await audioIdentity(reference.file)}:${await audioIdentity(file)}`;
        const cached = await derivedCache<SoundMatch>(key);
        if (cached) {
          signal.throwIfAborted();
          return cached;
        }
        const { readMono } = await import("@sidecut/platform-browser/source-analysis");
        const { syncSound } = await import("@sidecut/platform-browser/sound-sync");
        const a = await readMono(reference.file, reference.item, 8000, signal, (v) =>
          progress(v * 0.3),
        );
        const b = await readMono(file, item, 8000, signal, (v) => progress(0.3 + v * 0.3));
        const match = await syncSound(a, b, signal);
        signal.throwIfAborted();
        await derivedCache(key, match);
        return match;
      },
      (match) => {
        const project = this.session.getSnapshot().project,
          reference = project.media.find((m) => m.id === referenceID),
          item = project.media.find((m) => m.id === id);
        if (!reference || !item) throw new Error("The sync source was removed.");
        const takeID = reference.takeID ?? item.takeID ?? `take:${referenceID}`;
        const referenceOffset = reference.takeOffset?.seconds ?? 0,
          fileOffset = referenceOffset - match.offset;
        const shift = Math.max(0, -Math.min(referenceOffset, fileOffset));
        const members = project.media.filter(
          (m) => m.takeID === takeID || m.id === referenceID || m.id === id,
        );
        this.session.apply({
          label: "Align recorded take by sound",
          expectedRevision: revision,
          commands: members.map((m) => ({
            updateMedia: {
              mediaID: m.id,
              patch: {
                takeID,
                takeOffset:
                  m.id === id
                    ? fileOffset + shift
                    : m.id === referenceID
                      ? referenceOffset + shift
                      : (m.takeOffset?.seconds ?? 0) + shift,
              },
            },
          })),
        });
        return {
          status: `Aligned: confidence ${match.confidence.toFixed(1)}, file time offset ${match.offset.toFixed(5)} s. Existing clips keep their placement; place the synced take again to use new offsets.`,
        };
      },
    );
  }
}
