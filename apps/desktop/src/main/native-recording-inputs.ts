import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  NativeCaptureDevice,
  NativeRecordingRequest,
} from "@sidecut/contracts/native-recording";

export type NativeInput = { args: string[]; video: boolean; audio: boolean };
type Device = NativeCaptureDevice & { input: string };

// DirectShow uses ':' as a separator; reject names that could alter its input syntax.
function safeName(name: string): boolean {
  // eslint-disable-next-line no-control-regex -- Device strings must not contain control characters.
  return name.length > 0 && name.length <= 1024 && !/[\x00-\x1f\x7f:"]/.test(name);
}

export function parseNativeDevices(log: string): Device[] {
  const found: { name: string; kind: Device["kind"]; alternative?: string }[] = [];
  let section: Device["kind"] | undefined;
  let current: (typeof found)[number] | undefined;
  for (const line of log.split(/\r?\n/)) {
    if (/DirectShow video devices/i.test(line)) {
      section = "camera";
      current = undefined;
      continue;
    }
    if (/DirectShow audio devices/i.test(line)) {
      section = "microphone";
      current = undefined;
      continue;
    }
    const alternative = line.match(/Alternative name\s+"([^"]*)"/i);
    if (alternative) {
      if (current && alternative[1]) current.alternative = alternative[1];
      continue;
    }
    const match = line.match(/\]\s+"([^"]*)"(?:\s+\((video|audio)\))?\s*$/i);
    if (!match?.[1]) {
      current = undefined;
      continue;
    }
    const kind = match[2]
      ? match[2].toLowerCase() === "video"
        ? "camera"
        : "microphone"
      : section;
    if (!kind) {
      current = undefined;
      continue;
    }
    current = { name: match[1], kind };
    found.push(current);
  }
  const candidates = found
    .filter((device) => safeName(device.name))
    .map((device) => ({
      ...device,
      input: device.alternative && safeName(device.alternative) ? device.alternative : device.name,
    }));
  return candidates
    .filter(
      (device) =>
        found.filter(
          (other) =>
            other.kind === device.kind &&
            (other.name === device.input || other.alternative === device.input),
        ).length === 1,
    )
    .map(({ name, kind, input }) => ({
      name,
      kind,
      input,
      id: createHash("sha256").update(kind).update("\0").update(input).digest("hex"),
    }));
}

function listDirectShow(ffmpeg: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let log = "";
    let failure: string | undefined;
    const timer = setTimeout(() => {
      failure = "DirectShow enumeration timed out.";
      child.kill();
    }, 5000);
    child.stderr.on("data", (chunk: Buffer) => {
      if (log.length + chunk.length > 1024 * 1024) {
        failure = "DirectShow enumeration exceeded its output limit.";
        child.kill();
      } else log += chunk.toString("utf8");
    });
    child.on("error", () => {
      failure = "Could not start DirectShow enumeration.";
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (failure) reject(new Error(failure));
      else if (
        !/DirectShow (?:video|audio) devices|Could not enumerate (?:video|audio) devices|\]\s+"[^"\r\n]+"\s+\((?:video|audio)\)/i.test(
          log,
        )
      )
        reject(new Error("DirectShow device enumeration failed."));
      else resolve(log);
    });
  });
}

async function devices(ffmpeg: string): Promise<Device[]> {
  if (process.platform !== "win32") throw new Error("Native capture is only supported on Windows.");
  return parseNativeDevices(await listDirectShow(ffmpeg));
}

export async function nativeDevices(ffmpeg: string): Promise<NativeCaptureDevice[]> {
  return (await devices(ffmpeg)).map(({ id, name, kind }) => ({ id, name, kind }));
}

export function assembleNativeInputs(
  request: NativeRecordingRequest,
  available: Device[],
): NativeInput {
  const select = (id: string | undefined, kind: Device["kind"]): Device => {
    const matches = available.filter((device) => device.id === id && device.kind === kind);
    const selected = matches[0];
    if (!id || matches.length !== 1 || !selected || !safeName(selected.input))
      throw new Error(`Selected ${kind} device is missing or unavailable.`);
    return selected;
  };
  if (!["screen", "camera", "microphone"].includes(request.source))
    throw new Error("Invalid capture source.");
  const audio =
    request.source === "microphone"
      ? select(request.deviceID, "microphone")
      : request.microphoneID === undefined
        ? undefined
        : select(request.microphoneID, "microphone");
  const camera = request.source === "camera" ? select(request.deviceID, "camera") : undefined;
  const args: string[] = [];
  if (audio) args.push("-thread_queue_size", "32", "-f", "dshow", "-i", `audio=${audio.input}`);
  if (camera) args.push("-thread_queue_size", "4", "-f", "dshow", "-i", `video=${camera.input}`);
  else if (request.source === "screen")
    args.push("-thread_queue_size", "4", "-f", "gdigrab", "-framerate", "30", "-i", "desktop");
  const video = request.source !== "microphone";
  if (video) args.push("-map", `${audio ? 1 : 0}:v:0`);
  if (audio) args.push("-map", "0:a:0");
  return { args, video, audio: Boolean(audio) };
}

export async function nativeInputs(
  ffmpeg: string,
  request: NativeRecordingRequest,
): Promise<NativeInput> {
  if (process.platform !== "win32") throw new Error("Native capture is only supported on Windows.");
  const needsDevices = request.source !== "screen" || request.microphoneID !== undefined;
  return assembleNativeInputs(request, needsDevices ? await devices(ffmpeg) : []);
}
