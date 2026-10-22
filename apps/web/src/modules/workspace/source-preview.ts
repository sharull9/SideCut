import { mixTimelineAudio, prepareTimelineAudio } from "@sidecut/platform-browser/audio";
import { measureSource } from "@sidecut/platform-browser/audio-analysis";
import { createLUTLoader } from "@sidecut/platform-browser/lut";
import { paintPicture } from "@sidecut/platform-browser/picture";
import { LocalMediaReader, PlaybackClock } from "@sidecut/platform-browser/preview";
import type { Project, Clip } from "@sidecut/contracts/project";
import { activeClips, previewIssue, projectDuration } from "./timeline-model";
import type { BrowserProjectSession } from "./browser-session";

export class SourcePreview {
  private project: Project;
  private readonly lut;
  private readers = new Map<string, Promise<LocalMediaReader>>();
  private context: AudioContext | null = null;
  private clock: PlaybackClock | null = null;
  private nodes = new Set<AudioBufferSourceNode>();
  private audioWork: AbortController | null = null;
  private animation = 0;
  private token = 0;
  private playing = false;
  private painting = false;
  private wanted: { time: number; token: number } | null = null;
  private disposed = false;
  private scratch: HTMLCanvasElement | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly session: BrowserProjectSession,
    private readonly onTime: (time: number) => void,
    private readonly onStopped: () => void,
    private readonly onError: (message: string | null) => void,
  ) {
    this.project = session.getSnapshot().project;
    this.lut = createLUTLoader((id) => session.resource(id));
  }

  update(project: Project) {
    this.pause();
    if (project !== this.project) {
      for (const reader of this.readers.values())
        void reader.then(
          (value) => value.close(),
          () => {},
        );
      this.readers.clear();
    }
    this.project = project;
    const scale = Math.min(1, 1280 / project.settings.width, 1280 / project.settings.height);
    this.canvas.width = Math.max(1, Math.round(project.settings.width * scale));
    this.canvas.height = Math.max(1, Math.round(project.settings.height * scale));
  }

  private async reader(id: string) {
    if (this.disposed) throw new Error("Preview is closed.");
    let pending = this.readers.get(id);
    if (!pending) {
      const item = this.project.media.find((candidate) => candidate.id === id);
      if (!item) throw new Error(`Media ${id} is not in this project.`);
      pending = (async () => {
        const resource = await this.session.resource(id);
        if (!resource || resource.state !== "available")
          throw new Error(`${item.path}: source is missing or unsupported on this device.`);
        const value = await LocalMediaReader.open(resource.file, item.kind);
        if (this.disposed) {
          value.close();
          throw new Error("Preview is closed.");
        }
        return value;
      })();
      this.readers.set(id, pending);
      void pending.catch(() => {
        if (this.readers.get(id) === pending) this.readers.delete(id);
      });
    }
    return pending;
  }
  private mediaID(clip: Clip): string {
    const media = clip.content.media;
    if (
      media &&
      typeof media === "object" &&
      "mediaID" in media &&
      typeof media.mediaID === "string"
    )
      return media.mediaID;
    throw new Error("This clip is not a media source.");
  }

  private async draw(time: number, token: number) {
    const issue = previewIssue(this.project, time);
    if (issue) throw new Error(issue);
    const scratch = (this.scratch ??= document.createElement("canvas"));
    scratch.width = this.canvas.width;
    scratch.height = this.canvas.height;
    const stage = scratch.getContext("2d");
    if (!stage) throw new Error("Canvas preview is unavailable.");
    const timestamp = await paintPicture(
      stage,
      this.project,
      time,
      (id) => this.reader(id),
      undefined,
      this.lut,
    );
    if (token !== this.token || this.disposed) return;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas preview is unavailable.");
    ctx.drawImage(scratch, 0, 0);
    if (timestamp == null) delete this.canvas.dataset.sourceTime;
    else this.canvas.dataset.sourceTime = String(timestamp);
  }
  seek(time: number) {
    this.stop();
    this.onError(null);
    this.paint(time, this.token);
  }
  private paint(time: number, token: number) {
    this.wanted = { time, token };
    if (this.painting) return;
    this.painting = true;
    void (async () => {
      try {
        while (this.wanted) {
          const next = this.wanted;
          this.wanted = null;
          try {
            await this.draw(next.time, next.token);
          } catch (error) {
            if (next.token === this.token) this.fail(error);
          }
        }
      } finally {
        this.painting = false;
      }
    })();
  }

  async play(time: number) {
    this.stop();
    const token = this.token;
    this.onError(null);
    try {
      const end = projectDuration(this.project).seconds;
      if (!end) {
        this.onStopped();
        return;
      }
      if (time >= end) time = 0;
      const boundaries = [
        time,
        ...[...this.project.videoTracks, ...this.project.audioTracks]
          .flatMap((track) => track.clips.map((clip) => clip.start.seconds))
          .filter((start) => start >= time),
      ];
      for (const boundary of boundaries) {
        const issue = previewIssue(this.project, boundary);
        if (issue) throw new Error(issue);
      }
      this.context ??= new AudioContext();
      await this.context.resume();
      await Promise.all(
        [...activeClips(this.project, time, "video"), ...activeClips(this.project, time, "audio")]
          .filter(({ clip }) => clip.content.media != null)
          .map(({ clip }) => this.reader(this.mediaID(clip))),
      );
      await this.draw(time, token);
      if (token !== this.token || this.disposed) return;
      const work = new AbortController();
      this.audioWork = work;
      const measure = async (id: string) => {
        const local = await this.session.resource(id);
        if (!local || local.state !== "available") throw new Error(`Source ${id} is missing.`);
        return measureSource(local.file, await this.reader(id), work.signal);
      };
      const prepared = await prepareTimelineAudio(
        this.project,
        (id) => this.reader(id),
        work.signal,
        { start: time, measure },
      );
      work.signal.throwIfAborted();
      const blocks = mixTimelineAudio(
        this.project,
        (id) => this.reader(id),
        work.signal,
        48000,
        4096,
        end,
        {
          start: time,
          measure,
          prepared,
        },
      );
      const first = await blocks.next();
      if (token !== this.token || this.disposed) {
        await blocks.return();
        return;
      }
      this.clock = new PlaybackClock(() => this.context?.currentTime ?? 0);
      this.clock.start(time, 0.1);
      this.playing = true;
      void this.scheduleMix(blocks, first, token).catch((error) => {
        if (token === this.token) this.fail(error);
      });
      const tick = () => {
        if (token !== this.token || !this.playing || !this.clock) return;
        const position = this.clock.position(end);
        this.onTime(position);
        this.paint(
          position >= end
            ? Math.max(
                0,
                end -
                  this.project.settings.frameRate.denominator /
                    this.project.settings.frameRate.numerator,
              )
            : position,
          token,
        );
        if (position >= end) {
          this.stop();
          this.onStopped();
          return;
        }
        this.animation = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      if (token === this.token) this.fail(error);
    }
  }
  private async scheduleMix(
    blocks: ReturnType<typeof mixTimelineAudio>,
    first: Awaited<ReturnType<ReturnType<typeof mixTimelineAudio>["next"]>>,
    token: number,
  ) {
    const context = this.context,
      clock = this.clock;
    if (!context || !clock) return;
    try {
      let next = first;
      while (!next.done) {
        const item = next.value;
        if (token !== this.token) return;
        const when = clock.audioTime(item.timestamp);
        while (when - context.currentTime > 0.25) {
          if (token !== this.token) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (token !== this.token) return;
        const late = Math.max(0, context.currentTime - when);
        const duration = item.frames / item.sampleRate;
        if (duration > late) {
          const buffer = context.createBuffer(2, item.frames, item.sampleRate);
          for (let c = 0; c < 2; c++)
            buffer
              .getChannelData(c)
              .set(item.data.subarray(c * item.frames, (c + 1) * item.frames));
          const node = context.createBufferSource();
          node.buffer = buffer;
          node.connect(context.destination);
          this.nodes.add(node);
          node.onended = () => {
            node.disconnect();
            this.nodes.delete(node);
          };
          node.start(Math.max(when, context.currentTime), late, duration - late);
        }
        next = await blocks.next();
      }
    } finally {
      await blocks.return();
    }
  }
  pause() {
    if (this.playing && this.clock)
      this.onTime(this.clock.position(projectDuration(this.project).seconds));
    this.stop();
    this.onStopped();
  }
  private stop() {
    ++this.token;
    this.playing = false;
    cancelAnimationFrame(this.animation);
    this.wanted = null;
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        /* Already ended. */
      }
      node.disconnect();
    }
    this.nodes.clear();
    this.audioWork?.abort();
    this.audioWork = null;
  }
  private fail(error: unknown) {
    this.stop();
    this.onError(error instanceof Error ? error.message : String(error));
    this.onStopped();
  }
  release() {
    this.stop();
    for (const pending of this.readers.values())
      void pending.then(
        (reader) => reader.close(),
        () => {},
      );
    this.readers.clear();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
  close() {
    this.disposed = true;
    this.release();
  }
}
