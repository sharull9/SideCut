import { gain } from "@sidecut/core/audio-processing";
import { DEFAULT_LIVE_AUDIO, liveAudioSettings, liveMeter } from "@sidecut/core/live-audio";
import type { LiveAudioSettings } from "@sidecut/core/live-audio";

/** Each input owns only its graph edges, never the device tracks or caller's source node. */
export class LiveAudioChannel {
  private readonly filter: BiquadFilterNode;
  private readonly delay: DelayNode;
  private readonly level: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly rightAnalyser: AnalyserNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly monitorLevel: GainNode;
  private readonly samples = new Float32Array(2048);
  private closed = false;
  private settings: LiveAudioSettings;
  constructor(
    private readonly context: BaseAudioContext,
    private readonly source: AudioNode,
    program: AudioNode,
    monitor: AudioNode,
    input: unknown = DEFAULT_LIVE_AUDIO,
  ) {
    this.settings = liveAudioSettings(input);
    if (source.context !== context || program.context !== context || monitor.context !== context)
      throw new Error("Audio nodes must share one context.");
    this.filter = context.createBiquadFilter();
    this.delay = context.createDelay(2);
    this.level = context.createGain();
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = this.samples.length;
    this.rightAnalyser = context.createAnalyser();
    this.rightAnalyser.fftSize = this.samples.length;
    this.splitter = context.createChannelSplitter(2);
    this.monitorLevel = context.createGain();
    this.apply(this.settings, true);
    source.connect(this.filter).connect(this.delay).connect(this.level).connect(program);
    this.level.connect(this.monitorLevel).connect(monitor);
    this.level.connect(this.splitter);
    this.splitter.connect(this.analyser, 0);
    this.splitter.connect(this.rightAnalyser, 1);
  }
  private apply(settings: LiveAudioSettings, immediate: boolean) {
    const time = this.context.currentTime;
    this.filter.type = settings.cleanup === "rumble" ? "highpass" : "allpass";
    this.filter.frequency.setValueAtTime(settings.cleanup === "rumble" ? 80 : 0, time);
    this.filter.Q.setValueAtTime(Math.SQRT1_2, time);
    this.delay.delayTime.setValueAtTime(settings.syncOffsetMs / 1000, time);
    const set = (param: AudioParam, value: number) => {
      param.cancelScheduledValues(time);
      if (immediate) param.setValueAtTime(value, time);
      else param.setTargetAtTime(value, time, 0.005);
    };
    set(this.level.gain, settings.muted ? 0 : gain(settings.gainDB));
    set(this.monitorLevel.gain, settings.monitor ? 1 : 0);
  }
  update(input: unknown) {
    if (this.closed) throw new Error("Audio channel closed.");
    const settings = liveAudioSettings(input);
    this.apply(settings, false);
    this.settings = settings;
  }
  get state() {
    return { ...this.settings };
  }
  meter() {
    if (this.closed) return liveMeter(new Float32Array());
    this.analyser.getFloatTimeDomainData(this.samples);
    const left = liveMeter(this.samples);
    this.rightAnalyser.getFloatTimeDomainData(this.samples);
    const right = liveMeter(this.samples);
    return {
      peak: Math.max(left.peak, right.peak),
      rms: Math.max(left.rms, right.rms),
      peakDB: Math.max(left.peakDB, right.peakDB),
      rmsDB: Math.max(left.rmsDB, right.rmsDB),
      clipped: left.clipped || right.clipped,
    };
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.source.disconnect(this.filter);
    for (const node of [
      this.filter,
      this.delay,
      this.level,
      this.analyser,
      this.rightAnalyser,
      this.splitter,
      this.monitorLevel,
    ])
      node.disconnect();
  }
}

export class LiveAudioMixer {
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly program: GainNode;
  private readonly inputs = new Map<string, { channel: LiveAudioChannel; cleanup: () => void }>();
  private readonly sounds = new Map<string, AudioBufferSourceNode>();
  private closed = false;
  constructor(readonly context: AudioContext) {
    this.destination = context.createMediaStreamDestination();
    this.program = context.createGain();
    this.program.connect(this.destination);
  }
  private check() {
    if (this.closed) throw new Error("Audio mixer closed.");
  }
  get stream() {
    this.check();
    return this.destination.stream;
  }
  async resume() {
    this.check();
    await this.context.resume();
  }
  addNode(id: string, source: AudioNode, input: unknown = DEFAULT_LIVE_AUDIO) {
    this.check();
    if (!id || id.length > 100 || this.inputs.has(id) || this.inputs.size >= 32)
      throw new Error("Use up to 32 uniquely named audio inputs.");
    const channel = new LiveAudioChannel(
      this.context,
      source,
      this.program,
      this.context.destination,
      input,
    );
    this.inputs.set(id, { channel, cleanup: () => {} });
    return channel;
  }
  addStream(id: string, stream: MediaStream, input: unknown = DEFAULT_LIVE_AUDIO) {
    this.check();
    const tracks = stream.getAudioTracks();
    if (tracks.length !== 1 || tracks[0]?.readyState !== "live")
      throw new Error("Select exactly one live audio track per input.");
    const track = tracks[0];
    const source = this.context.createMediaStreamSource(new MediaStream([track]));
    const channel = this.addNode(id, source, input);
    const ended = () => this.remove(id);
    track.addEventListener("ended", ended, { once: true });
    this.inputs.set(id, {
      channel,
      cleanup: () => {
        track.removeEventListener("ended", ended);
        source.disconnect();
      },
    });
    return channel;
  }
  remove(id: string) {
    const sound = this.sounds.get(id);
    if (sound) {
      this.sounds.delete(id);
      sound.onended = null;
      sound.stop();
    }
    const input = this.inputs.get(id);
    if (!input) return;
    this.inputs.delete(id);
    input.channel.close();
    input.cleanup();
  }
  play(id: string, buffer: AudioBuffer, input: unknown = DEFAULT_LIVE_AUDIO, when?: number) {
    this.check();
    const startAt = when ?? this.context.currentTime + 0.01;
    if (
      !Number.isFinite(buffer.duration) ||
      buffer.duration <= 0 ||
      buffer.duration > 30 ||
      buffer.length * buffer.numberOfChannels * 4 > 32 * 1024 * 1024 ||
      !Number.isFinite(startAt) ||
      startAt < this.context.currentTime ||
      startAt > this.context.currentTime + 10
    )
      throw new Error(
        "Soundboard needs a clip up to 30 seconds, 32 MiB and scheduled within 10 seconds.",
      );
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    const channel = this.addNode(id, source, input);
    this.sounds.set(id, source);
    source.onended = () => {
      this.sounds.delete(id);
      this.remove(id);
    };
    try {
      source.start(startAt);
    } catch (error) {
      this.sounds.delete(id);
      this.remove(id);
      throw error;
    }
    return channel;
  }
  stop(id: string) {
    const source = this.sounds.get(id);
    if (source) {
      this.sounds.delete(id);
      source.onended = null;
      source.stop();
    }
    this.remove(id);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.sounds.keys()]) this.stop(id);
    for (const id of [...this.inputs.keys()]) this.remove(id);
    this.program.disconnect();
    for (const track of this.destination.stream.getTracks()) track.stop();
  }
}
