import type { LiveStudio } from "@sidecut/core/live-studio";
import { paintPicture } from "./picture";
import { paintLiveBackground, paintLiveOverlays } from "./live-assets";

/** Preview this canvas and record its stream; both receive the same completed frame. */
export class LiveStudioOutput {
  private busy = false;
  private closed = false;
  private stream: MediaStream | null = null;
  private audioInputId: string | null = null;
  private readonly staging: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly output: CanvasRenderingContext2D;
  private committed: {
    sceneId: string;
    sceneRevision: number;
    commitRevision: number;
    time: number;
  } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly studio: LiveStudio,
    private readonly reader: Parameters<typeof paintPicture>[3],
  ) {
    this.staging = document.createElement("canvas");
    const context = this.staging.getContext("2d");
    const output = canvas.getContext("2d");
    if (!context || !output) throw new Error("Studio needs a 2D canvas.");
    this.context = context;
    this.output = output;
  }
  get currentFrame() {
    return this.committed ? { ...this.committed } : null;
  }
  recordingStream(audio?: MediaStream) {
    if (this.closed) throw new Error("Studio output closed.");
    if (!this.committed) throw new Error("Render a complete frame before recording.");
    const tracks = audio?.getAudioTracks();
    if (tracks && (tracks.length !== 1 || tracks[0]?.readyState !== "live"))
      throw new Error("Studio recording needs exactly one live mixed audio track.");
    if (audio && this.audioInputId && this.audioInputId !== audio.id)
      throw new Error("Recording is already bound to another audio mix.");
    if (!this.stream) {
      this.stream = this.canvas.captureStream(0);
      const track = this.stream.getVideoTracks()[0];
      if (!track || !("requestFrame" in track) || typeof track.requestFrame !== "function") {
        this.close();
        throw new Error("Explicit canvas capture frames are unavailable.");
      }
    }
    if (audio && !this.audioInputId) {
      for (const track of audio.getAudioTracks()) this.stream.addTrack(track.clone());
      this.audioInputId = audio.id;
    }
    return this.stream;
  }
  async render(time: number, signal?: AbortSignal) {
    if (this.closed) throw new Error("Studio output closed.");
    if (this.busy) return null;
    this.busy = true;
    try {
      signal?.throwIfAborted();
      const frame = this.studio.frame(time);
      const assets = frame.assets;
      const { width, height } = frame.project.settings;
      if (width > 3840 || height > 3840 || width * height > 3840 * 2160)
        throw new Error("Studio output exceeds the 4K pixel limit.");
      this.staging.width = width;
      this.staging.height = height;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      await paintPicture(
        this.context,
        frame.project,
        time,
        this.reader,
        signal,
        undefined,
        assets ? (context) => paintLiveBackground(context, assets, time, reducedMotion) : undefined,
      );
      if (assets) paintLiveOverlays(this.context, assets, time, reducedMotion);
      signal?.throwIfAborted();
      if (this.closed) return null;
      if (this.studio.frame(time).commitRevision !== frame.commitRevision) return null;
      if (this.canvas.width !== width) this.canvas.width = width;
      if (this.canvas.height !== height) this.canvas.height = height;
      this.output.setTransform(1, 0, 0, 1, 0, 0);
      this.output.globalAlpha = 1;
      this.output.drawImage(this.staging, 0, 0);
      this.committed = {
        sceneId: frame.sceneId,
        sceneRevision: frame.sceneRevision,
        commitRevision: frame.commitRevision,
        time,
      };
      const track = this.stream?.getVideoTracks()[0];
      if (track && "requestFrame" in track && typeof track.requestFrame === "function")
        track.requestFrame();
      return this.currentFrame;
    } finally {
      this.busy = false;
    }
  }
  close() {
    this.closed = true;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }
}
