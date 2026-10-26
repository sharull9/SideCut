import type { Input, CanvasSink, AudioBufferSink } from "mediabunny";
import type { Cutout } from "@sidecut/core/cutout";
import type { PictureProxy } from "./proxy";
import { proxyFrameIndex } from "./proxy";
import { readFrame } from "./frame-store";
import { openAnimatedImage, openLottie, type AnimationSource } from "./animation";

export class LocalMediaReader {
  private file: File | null = null;
  async cutout(
    source: CanvasImageSource,
    width: number,
    height: number,
    time: number,
    settings: Cutout,
  ) {
    const { cachedMatte, compositeCutout } = await import("./cutout");
    const matte = this.file ? await cachedMatte(this.file) : undefined;
    if (!matte)
      throw new Error(
        "Cutout matte is unavailable. Analyse cutout in the Picture inspector first.",
      );
    return compositeCutout(source, width, height, matte, this.image ? 0 : time, settings);
  }
  private input: Input | null = null;
  private picture: CanvasSink | null = null;
  private sound: AudioBufferSink | null = null;
  private image: ImageBitmap | null = null;
  private animation: AnimationSource | null = null;
  private closed = false;
  private proxy: PictureProxy | undefined;
  private proxyBitmap: { index: number; bitmap: ImageBitmap } | undefined;

  useProxy(proxy: PictureProxy) {
    this.proxy = proxy;
  }

  frames() {
    if (this.closed || !this.picture) throw new Error("Source has no decodable picture.");
    return this.picture.canvases();
  }
  async frameTimes(signal: AbortSignal) {
    signal.throwIfAborted();
    const video = await this.input?.getPrimaryVideoTrack();
    if (!video) return [];
    const { EncodedPacketSink } = await import("mediabunny"),
      times: number[] = [];
    for await (const packet of new EncodedPacketSink(video).packets(undefined, undefined, {
      metadataOnly: true,
    })) {
      signal.throwIfAborted();
      times.push(packet.timestamp);
      if (times.length > 1000000)
        throw new Error("Source packet table exceeds one million frames.");
    }
    return [...new Set(times)].sort((a, b) => a - b);
  }
  get animated() {
    return this.animation !== null;
  }

  static async open(
    file: File,
    kind: "video" | "audio" | "image",
    maxWidth = 1280,
  ): Promise<LocalMediaReader> {
    const reader = new LocalMediaReader();
    reader.file = file;
    try {
      if (kind === "image") {
        if (file.type === "application/x-sidecut-lottie" || /\.json$/i.test(file.name))
          reader.animation = await openLottie(file);
        else {
          reader.animation = await openAnimatedImage(file);
          if (!reader.animation) reader.image = await createImageBitmap(file);
        }
      } else {
        const { Input, BlobSource, ALL_FORMATS, CanvasSink, AudioBufferSink } =
          await import("mediabunny");
        reader.input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        const [video, audio] = await Promise.all([
          reader.input.getPrimaryVideoTrack(),
          reader.input.getPrimaryAudioTrack(),
        ]);
        if (video)
          reader.picture = new CanvasSink(video, {
            alpha: true,
            width: Math.min(maxWidth, await video.getDisplayWidth()),
            poolSize: 2,
          });
        if (audio) {
          if (typeof AudioBuffer === "undefined")
            throw new Error(
              "This browser cannot render audio: Web Audio AudioBuffer support is unavailable.",
            );
          reader.sound = new AudioBufferSink(audio);
        }
      }
      return reader;
    } catch (error) {
      reader.close();
      throw error;
    }
  }
  async frame(time: number) {
    if (this.closed) throw new Error("Media reader is closed.");
    if (this.animation)
      return {
        canvas: await this.animation.frame(time),
        width: this.animation.width,
        height: this.animation.height,
        timestamp: time,
        duration: this.animation.duration,
      };
    if (this.proxy) {
      const index = proxyFrameIndex(this.proxy, time),
        frame = this.proxy.frames[index];
      if (!frame) return null;
      if (this.proxyBitmap?.index !== index) {
        const bitmap = await createImageBitmap(await readFrame(frame.image));
        if (this.closed) {
          bitmap.close();
          throw new Error("Media reader is closed.");
        }
        this.proxyBitmap?.bitmap.close();
        this.proxyBitmap = { index, bitmap };
      }
      return {
        canvas: this.proxyBitmap.bitmap,
        width: this.proxy.width,
        height: this.proxy.height,
        timestamp: frame.timestamp,
        duration: frame.duration,
      };
    }
    if (this.image)
      return {
        canvas: this.image,
        width: this.image.width,
        height: this.image.height,
        timestamp: 0,
        duration: Infinity,
      };
    if (!this.picture) throw new Error("Source has no decodable picture.");
    const frame = await this.picture.getCanvas(time);
    return frame ? { ...frame, width: frame.canvas.width, height: frame.canvas.height } : null;
  }
  audio(start: number, end: number) {
    if (this.closed || !this.sound) throw new Error("Source has no decodable sound.");
    return this.sound.buffers(start, end);
  }
  close() {
    this.closed = true;
    this.animation?.close();
    this.animation = null;
    this.proxyBitmap?.bitmap.close();
    this.proxyBitmap = undefined;
    this.proxy = undefined;
    this.input?.dispose();
    this.input = null;
    this.image?.close();
    this.image = null;
    this.picture = null;
    this.sound = null;
  }
}

export class PlaybackClock {
  private origin = 0;
  private offset = 0;
  constructor(private readonly now: () => number) {}
  start(at: number, delay = 0) {
    this.offset = at;
    this.origin = this.now() + delay;
  }
  position(end: number) {
    return Math.min(end, this.offset + Math.max(0, this.now() - this.origin));
  }
  audioTime(timelineTime: number) {
    return this.origin + timelineTime - this.offset;
  }
}
