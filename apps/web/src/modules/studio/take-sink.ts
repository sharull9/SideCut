/**
 * Where a studio take's bytes go while it records, and what is left when it stops.
 *
 * Every chunk is written to disk (origin-private storage) when the browser can, or kept in
 * memory up to a cap when it cannot (Safari). A cloud take also uploads each chunk while
 * recording. On finish a cloud take that uploaded becomes `uploaded`; otherwise whatever is on
 * disk or in memory becomes a `local` take, so a failed upload never loses the recording.
 */
import type { TakeInfo, TakeMark } from "./take-store";

export type StudioTake = { file: File; url: string; marks: TakeMark[]; stored: boolean };

export type SinkOutcome =
  | { kind: "uploaded"; mediaId: string }
  | { kind: "local"; take: StudioTake; failure?: string }
  | { kind: "none"; failure?: string };

/** Something the recording should react to: a message to show, and whether to stop. */
export type SinkIssue = { failure?: string; notice?: string; stop: boolean };

export type TakeSink = {
  readonly cloud: boolean;
  readonly marks: readonly TakeMark[];
  write(chunk: Blob): void;
  mark(seconds: number, name: string): void;
  /** Called once, after the recorder's last chunk. */
  finish(): Promise<SinkOutcome>;
  /** Teardown while recording: keep the disk copy for recovery, stop feeding the upload. */
  abandon(): Promise<void>;
};

export type WriterLike = {
  readonly info: TakeInfo;
  readonly failed: boolean;
  write(chunk: Blob): void;
  mark(seconds: number, name: string): void;
  close(): Promise<File>;
  abort(): Promise<void>;
};

export type UploadLike = {
  readonly failed: boolean;
  push(chunk: Blob): void;
  finish(): Promise<void>;
};

export type CloudLike = { upload: UploadLike; mediaId: Promise<string> };

export type SinkDeps = {
  /** Rejects where takes cannot stream to disk; the sink then keeps a capped copy in memory. */
  createWriter(fileName: string): Promise<WriterLike>;
  /** Starts the cloud upload, or null for a take saved to this device. */
  beginCloud: ((fileName: string, marks: () => readonly TakeMark[]) => CloudLike) | null;
  limitBytes: number;
  createURL(file: File): string;
  /** Records which cloud file a disk take became, so the editor can open it without a download. */
  linkUpload(info: TakeInfo, mediaId: string): Promise<void>;
};

const message = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

export const sinkMessages = {
  diskFull: "This device ran out of room for the take.",
  memoryLimit: "Recording reached the 128 MiB limit for this browser and stopped.",
  cloudStart: (reason: string) => `The cloud upload could not start. ${reason}`.trim(),
  cloudFailedKept: (reason: string) =>
    `The cloud upload failed: ${reason}. The take is kept on this device.`,
  cloudFailedLost: (reason: string) =>
    `The cloud upload failed: ${reason}. The take was too long to keep in this browser.`,
};

export async function openTakeSink(
  fileName: string,
  type: string,
  deps: SinkDeps,
  report: (issue: SinkIssue) => void,
): Promise<TakeSink> {
  const writer = await deps.createWriter(fileName).catch(() => null);
  const marks: TakeMark[] = writer?.info.marks ?? [];
  let memory: Blob[] | null = writer ? null : [];
  const cloud = deps.beginCloud?.(fileName, () => marks) ?? null;
  cloud?.mediaId.catch((cause: unknown) =>
    report({ failure: sinkMessages.cloudStart(message(cause, "")), stop: false }),
  );
  let bytes = 0;
  let diskWarned = false;
  let uploadWarned = false;
  let done = false;

  const keepLocally = async (): Promise<StudioTake | null> => {
    if (writer) {
      try {
        const file = await writer.close();
        return { file, url: deps.createURL(file), marks, stored: true };
      } catch {
        await writer.abort().catch(() => {});
      }
    }
    if (!memory?.length) return null;
    const file = new File(memory, fileName, { type });
    return { file, url: deps.createURL(file), marks, stored: false };
  };

  return {
    cloud: Boolean(cloud),
    marks,
    write(chunk) {
      if (done || !chunk.size) return;
      bytes += chunk.size;
      cloud?.upload.push(chunk);
      writer?.write(chunk);
      if (cloud?.upload.failed && !uploadWarned) {
        uploadWarned = true;
        // The reason is reported on finish, with what was kept on this device.
        report({ stop: true });
      }
      if (writer?.failed && !diskWarned) {
        diskWarned = true;
        report({ failure: sinkMessages.diskFull, stop: !cloud });
      }
      if (memory) {
        if (bytes <= deps.limitBytes) memory.push(chunk);
        // The cloud copy carries on; only the in-memory fallback is dropped.
        else if (cloud) memory = null;
        else report({ notice: sinkMessages.memoryLimit, stop: true });
      }
    },
    mark(seconds, name) {
      if (writer) writer.mark(seconds, name);
      else marks.push({ seconds: Math.max(0, seconds), name });
    },
    async finish() {
      done = true;
      if (!cloud) {
        const take = await keepLocally();
        return take ? { kind: "local", take } : { kind: "none" };
      }
      try {
        await cloud.upload.finish();
        const mediaId = await cloud.mediaId;
        if (writer) {
          await writer.close().catch(() => writer.abort());
          await deps.linkUpload(writer.info, mediaId).catch(() => {});
        }
        return { kind: "uploaded", mediaId };
      } catch (cause) {
        const reason = message(cause, "unknown error");
        const take = await keepLocally();
        return take
          ? { kind: "local", take, failure: sinkMessages.cloudFailedKept(reason) }
          : { kind: "none", failure: sinkMessages.cloudFailedLost(reason) };
      }
    },
    async abandon() {
      done = true;
      if (writer) await writer.close().catch(() => writer.abort().catch(() => {}));
    },
  };
}
