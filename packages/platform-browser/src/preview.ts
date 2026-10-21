import type { Input, CanvasSink, AudioBufferSink } from "mediabunny";

export class LocalMediaReader {
  private input: Input | null = null;
  private picture: CanvasSink | null = null;
  private sound: AudioBufferSink | null = null;
  private image: ImageBitmap | null = null;
  private closed = false;

  static async open(
    file: File,
    kind: "video" | "audio" | "image",
    maxWidth = 1280,
  ): Promise<LocalMediaReader> {
    const reader = new LocalMediaReader();
    try {
      if (kind === "image") reader.image = await createImageBitmap(file);
      else {
        const { Input, BlobSource, ALL_FORMATS, CanvasSink, AudioBufferSink } =
          await import("mediabunny");
        reader.input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        const [video, audio] = await Promise.all([
          reader.input.getPrimaryVideoTrack(),
          reader.input.getPrimaryAudioTrack(),
        ]);
        if (video)
          reader.picture = new CanvasSink(video, {
            width: Math.min(maxWidth, await video.getDisplayWidth()),
            poolSize: 2,
          });
        if (audio) reader.sound = new AudioBufferSink(audio);
      }
      return reader;
    } catch (error) {
      reader.close();
      throw error;
    }
  }
  async frame(time: number) {
    if (this.closed) throw new Error("Media reader is closed.");
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
