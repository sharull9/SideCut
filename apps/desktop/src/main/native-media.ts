import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Executables are host configuration, never renderer-supplied commands or arguments.
export class NativeMedia {
  constructor(
    private readonly ffmpeg = "ffmpeg",
    private readonly ffprobe = "ffprobe",
  ) {}
  async run(
    operation: unknown,
    bytes: unknown,
    signal: AbortSignal,
    progress: (value: number) => void,
    start = 0,
    duration?: number,
  ): Promise<Uint8Array> {
    if (
      !["probe", "decode", "export"].includes(String(operation)) ||
      !(bytes instanceof Uint8Array) ||
      !bytes.length ||
      bytes.length > 256 * 1024 * 1024
    )
      throw new Error("Invalid native media operation or input. Maximum input is 256 MiB.");
    if (
      !Number.isFinite(start) ||
      start < 0 ||
      (duration !== undefined && (!Number.isFinite(duration) || duration <= 0 || duration > 300))
    )
      throw new Error("Invalid native media range.");
    signal.throwIfAborted();
    const folder = await mkdtemp(join(tmpdir(), "sidecut-media-")),
      input = join(folder, "input"),
      output = join(folder, operation === "decode" ? "output.wav" : "output.webm");
    try {
      await writeFile(input, bytes);
      const safeInput = [
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "wav,aiff,caf,mp3,aac,flac,ogg,mov,matroska,webm,png_pipe,jpeg_pipe,webp_pipe,gif,bmp_pipe,avi,mpeg",
      ];
      let total = duration;
      if (operation !== "probe" && total === undefined) {
        const info = JSON.parse(
          await this.execute(
            this.ffprobe,
            ["-v", "error", ...safeInput, "-show_format", "-of", "json", input],
            signal,
            () => {},
          ),
        ) as { format?: { duration?: string } };
        total = Number(info.format?.duration) - start;
      }
      if (operation !== "probe" && (!Number.isFinite(total) || !total || total <= 0 || total > 300))
        throw new Error("Native decode/export requires a known duration of up to five minutes.");
      progress(0);
      const range = [
        "-ss",
        String(start),
        ...(duration === undefined ? [] : ["-t", String(duration)]),
      ];
      const args =
        operation === "probe"
          ? ["-v", "error", ...safeInput, "-show_format", "-show_streams", "-of", "json", input]
          : [
              "-nostdin",
              "-v",
              "error",
              "-progress",
              "pipe:1",
              ...safeInput,
              "-i",
              input,
              ...range,
              ...(operation === "decode"
                ? ["-vn", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le"]
                : ["-c:v", "libvpx", "-b:v", "4M", "-c:a", "libopus"]),
              "-y",
              output,
            ];
      const result = await this.execute(
        operation === "probe" ? this.ffprobe : this.ffmpeg,
        args,
        signal,
        (line) => {
          const match = /out_time_us=(\d+)/.exec(line);
          if (match && total && total > 0)
            progress(Math.min(0.99, Number(match[1]) / 1_000_000 / total));
        },
      );
      signal.throwIfAborted();
      progress(1);
      if (operation === "probe") {
        JSON.parse(result);
        return new TextEncoder().encode(result);
      }
      if ((await stat(output)).size > 256 * 1024 * 1024)
        throw new Error("Native output exceeds 256 MiB.");
      return await readFile(output);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  execute(
    executable: string,
    args: string[],
    signal: AbortSignal,
    line: (value: string) => void,
  ): Promise<string> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        windowsHide: true,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "",
        failure: Error | undefined;
      const stop = () => {
        child.kill("SIGKILL");
      };
      signal.addEventListener("abort", stop, { once: true });
      const timeout = setTimeout(() => {
        failure = new Error("Native media job exceeded five minutes.");
        stop();
      }, 300_000);
      child.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        line(chunk);
        if (stdout.length > 4 * 1024 * 1024) {
          failure = new Error("Native media output exceeded its limit.");
          stop();
        }
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr = (stderr + data.toString()).slice(-8192);
      });
      child.on("error", (error) => {
        failure = new Error(`Native media could not start ${executable}: ${error.message}`);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", stop);
        if (signal.aborted) reject(new DOMException("Native media cancelled.", "AbortError"));
        else if (failure) reject(failure);
        else if (code !== 0) reject(new Error(`Native decoder failed (${code}): ${stderr}`));
        else resolve(stdout);
      });
      if (signal.aborted) stop();
    });
  }
}
