export interface CodecResult {
  codec: string;
  encode: boolean;
  decode: boolean;
  frames: number;
  detail: string;
}

export interface MediaProbeResult {
  browser: string;
  secureContext: boolean;
  codecs: CodecResult[];
  recording: {
    mimeType: string;
    bytes: number;
    width: number;
    height: number;
    audioChannels: number;
    audioFrames: number;
    audioRms: number;
  } | null;
  errors: string[];
}

function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after 10 seconds.`)), 10_000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function probeCodec(codec: string, canvas: HTMLCanvasElement): Promise<CodecResult> {
  const result: CodecResult = {
    codec,
    encode: false,
    decode: false,
    frames: 0,
    detail: "WebCodecs unavailable.",
  };
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return result;
  const config: VideoEncoderConfig = {
    codec,
    width: 64,
    height: 64,
    bitrate: 100_000,
    framerate: 10,
    latencyMode: "realtime",
  };
  let encoder: VideoEncoder | undefined;
  let decoder: VideoDecoder | undefined;
  try {
    result.encode = (await VideoEncoder.isConfigSupported(config)).supported === true;
    result.decode =
      (await VideoDecoder.isConfigSupported({ codec, codedWidth: 64, codedHeight: 64 }))
        .supported === true;
    if (!result.encode || !result.decode) {
      result.detail = "Encode/decode configuration is unsupported on this browser/device.";
      return result;
    }
    const chunks: EncodedVideoChunk[] = [];
    let decoderConfig: VideoDecoderConfig = { codec, codedWidth: 64, codedHeight: 64 };
    let codecError: Error | undefined;
    encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        chunks.push(chunk);
        if (metadata?.decoderConfig) decoderConfig = metadata.decoderConfig;
      },
      error: (error) => {
        codecError = error;
      },
    });
    encoder.configure(config);
    for (let i = 0; i < 3; i++) {
      const frame = new VideoFrame(canvas, { timestamp: i * 100_000, duration: 100_000 });
      try {
        encoder.encode(frame, { keyFrame: i === 0 });
      } finally {
        frame.close();
      }
    }
    await bounded(encoder.flush(), `${codec} encode`);
    if (codecError) throw codecError;
    decoder = new VideoDecoder({
      output: (frame) => {
        if (frame.displayWidth === 64 && frame.displayHeight === 64) result.frames++;
        frame.close();
      },
      error: (error) => {
        codecError = error;
      },
    });
    decoder.configure(decoderConfig);
    for (const chunk of chunks) decoder.decode(chunk);
    await bounded(decoder.flush(), `${codec} decode`);
    if (codecError) throw codecError;
    if (result.frames !== 3)
      throw new Error(`Expected 3 decoded frames; received ${result.frames}.`);
    result.detail = "Encoded and decoded 3 synthetic 64x64 frames.";
  } catch (error) {
    result.detail = error instanceof Error ? error.message : String(error);
  } finally {
    if (encoder && encoder.state !== "closed") encoder.close();
    if (decoder && decoder.state !== "closed") decoder.close();
  }
  return result;
}

async function recordFixture(
  canvas: HTMLCanvasElement,
  audio: AudioContext,
  mimeType: string,
): Promise<Blob> {
  const destination = audio.createMediaStreamDestination();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 440;
  gain.gain.value = 0.15;
  oscillator.connect(gain).connect(destination);
  const stream = canvas.captureStream(10);
  for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
  let recorder: MediaRecorder | undefined;
  let paint: ReturnType<typeof setInterval> | undefined;
  let stop: ReturnType<typeof setTimeout> | undefined;
  try {
    const chunks: Blob[] = [];
    recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 100_000,
      audioBitsPerSecond: 64_000,
    });
    const active = recorder;
    const finished = new Promise<Blob>((resolve, reject) => {
      active.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      active.onerror = () => reject(new Error("Browser recording failed."));
      active.onstop = () => resolve(new Blob(chunks, { type: active.mimeType }));
    });
    let n = 0;
    paint = setInterval(() => {
      const context = canvas.getContext("2d");
      if (!context) return;
      context.fillStyle = n++ % 2 === 0 ? "#16844b" : "#18251e";
      context.fillRect(0, 0, 64, 64);
    }, 100);
    oscillator.start();
    recorder.start();
    stop = setTimeout(() => {
      if (active.state !== "inactive") active.stop();
    }, 900);
    return await bounded(finished, "Audio/video recording");
  } finally {
    clearInterval(paint);
    clearTimeout(stop);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    oscillator.stop();
    oscillator.disconnect();
    gain.disconnect();
    destination.disconnect();
    for (const track of stream.getTracks()) track.stop();
  }
}

async function inspectRecording(
  blob: Blob,
  audio: AudioContext,
): Promise<NonNullable<MediaProbeResult["recording"]>> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  try {
    await bounded(
      new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () =>
          reject(new Error("Browser cannot decode the recorded video container."));
        video.src = url;
        video.load();
      }),
      "Recorded video decode",
    );
    const decoded = await bounded(
      audio.decodeAudioData(await blob.arrayBuffer()),
      "Recorded audio decode",
    );
    const samples = decoded.getChannelData(0);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length);
    if (video.videoWidth !== 64 || video.videoHeight !== 64 || !decoded.length || rms < 0.01) {
      throw new Error("Recorded output does not contain the expected picture and audible tone.");
    }
    return {
      mimeType: blob.type,
      bytes: blob.size,
      width: video.videoWidth,
      height: video.videoHeight,
      audioChannels: decoded.numberOfChannels,
      audioFrames: decoded.length,
      audioRms: rms,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function runMediaProbe(): Promise<{ result: MediaProbeResult; blob: Blob | null }> {
  const result: MediaProbeResult = {
    browser: navigator.userAgent,
    secureContext: window.isSecureContext,
    codecs: [],
    recording: null,
    errors: [],
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable.");
  context.fillStyle = "#16844b";
  context.fillRect(0, 0, 64, 64);
  // Resume inside the user's click before awaiting asynchronous codec checks.
  const audio = new AudioContext({ sampleRate: 48_000 });
  let blob: Blob | null = null;
  try {
    await bounded(audio.resume(), "Audio context start");
    for (const codec of ["vp8", "vp09.00.10.08", "avc1.42001e"]) {
      result.codecs.push(await probeCodec(codec, canvas));
    }
    if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
      throw new Error(
        "MediaRecorder or canvas capture is unavailable. No browser export path has been demonstrated.",
      );
    }
    const mimeType = [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("No candidate audio/video recording format is supported.");
    blob = await recordFixture(canvas, audio, mimeType);
    result.recording = await inspectRecording(blob, audio);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await audio.close();
  }
  return { result, blob: result.recording ? blob : null };
}
