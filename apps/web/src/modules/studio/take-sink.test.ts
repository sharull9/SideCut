import { describe, expect, it, vi } from "vite-plus/test";
import {
  openTakeSink,
  sinkMessages,
  type CloudLike,
  type SinkDeps,
  type SinkIssue,
  type WriterLike,
} from "./take-sink.ts";
import type { TakeInfo } from "./take-store.ts";

const chunk = (size: number) => new Blob([new Uint8Array(size)]);

class FakeWriter implements WriterLike {
  info: TakeInfo = { fileName: "take.webm", startedAt: 0, state: "recording", marks: [] };
  failed = false;
  bytes = 0;
  closeError: Error | null = null;
  abort = vi.fn(() => Promise.resolve());
  write(blob: Blob) {
    this.bytes += blob.size;
  }
  mark(seconds: number, name: string) {
    this.info.marks.push({ seconds, name });
  }
  close = vi.fn(() =>
    this.closeError
      ? Promise.reject(this.closeError)
      : Promise.resolve(new File([new Uint8Array(this.bytes)], this.info.fileName)),
  );
}

class FakeUpload {
  failed = false;
  bytes = 0;
  finishError: Error | null = null;
  push(blob: Blob) {
    this.bytes += blob.size;
  }
  finish = vi.fn(() => (this.finishError ? Promise.reject(this.finishError) : Promise.resolve()));
}

const setup = ({
  disk = true,
  cloud = false,
  limitBytes = 100,
  mediaId = Promise.resolve("m1"),
}: {
  disk?: boolean;
  cloud?: boolean;
  limitBytes?: number;
  mediaId?: Promise<string>;
} = {}) => {
  const writer = new FakeWriter();
  const upload = new FakeUpload();
  const issues: SinkIssue[] = [];
  const linked: [string, string][] = [];
  const deps: SinkDeps = {
    createWriter: () =>
      disk ? Promise.resolve(writer) : Promise.reject(new Error("no disk streaming")),
    beginCloud: cloud ? (): CloudLike => ({ upload, mediaId }) : null,
    limitBytes,
    createURL: (file) => `blob:${file.name}`,
    linkUpload: (info, id) => {
      linked.push([info.fileName, id]);
      return Promise.resolve();
    },
  };
  const open = () => openTakeSink("take.webm", "video/webm", deps, (issue) => issues.push(issue));
  return { open, writer, upload, issues, linked };
};

describe("take sink", () => {
  it("writes a device take to disk and returns it as stored", async () => {
    const { open, writer } = setup();
    const sink = await open();
    sink.write(chunk(10));
    sink.mark(1.5, "Mark 1");
    const outcome = await sink.finish();
    expect(writer.bytes).toBe(10);
    expect(outcome).toMatchObject({
      kind: "local",
      take: { stored: true, url: "blob:take.webm", marks: [{ seconds: 1.5, name: "Mark 1" }] },
    });
  });

  it("keeps a capped copy in memory where disk streaming is unsupported", async () => {
    const { open, issues } = setup({ disk: false, limitBytes: 15 });
    const sink = await open();
    sink.write(chunk(10));
    sink.mark(2, "Mark 1");
    expect(issues).toEqual([]);
    sink.write(chunk(10));
    expect(issues).toEqual([{ notice: sinkMessages.memoryLimit, stop: true }]);
    const outcome = await sink.finish();
    expect(outcome).toMatchObject({ kind: "local", take: { stored: false } });
    if (outcome.kind === "local") {
      expect(outcome.take.file.size).toBe(10);
      expect(outcome.take.marks).toEqual([{ seconds: 2, name: "Mark 1" }]);
    }
  });

  it("stops a device take when the disk fills, but keeps a cloud take going", async () => {
    const device = setup();
    const deviceSink = await device.open();
    device.writer.failed = true;
    deviceSink.write(chunk(1));
    deviceSink.write(chunk(1));
    expect(device.issues).toEqual([{ failure: sinkMessages.diskFull, stop: true }]);

    const cloud = setup({ cloud: true });
    const cloudSink = await cloud.open();
    cloud.writer.failed = true;
    cloudSink.write(chunk(1));
    expect(cloud.issues).toEqual([{ failure: sinkMessages.diskFull, stop: false }]);
  });

  it("uploads a cloud take and links the disk copy to the cloud file", async () => {
    const { open, upload, writer, linked } = setup({ cloud: true });
    const sink = await open();
    sink.write(chunk(8));
    expect(upload.bytes).toBe(8);
    expect(writer.bytes).toBe(8);
    expect(await sink.finish()).toEqual({ kind: "uploaded", mediaId: "m1" });
    expect(writer.close).toHaveBeenCalled();
    expect(linked).toEqual([["take.webm", "m1"]]);
  });

  it("asks to stop when the upload fails, then keeps the take on this device", async () => {
    const { open, upload, issues } = setup({ cloud: true });
    const sink = await open();
    upload.failed = true;
    sink.write(chunk(4));
    sink.write(chunk(4));
    expect(issues).toEqual([{ stop: true }]);
    upload.finishError = new Error("offline");
    expect(await sink.finish()).toMatchObject({
      kind: "local",
      take: { stored: true },
      failure: sinkMessages.cloudFailedKept("offline"),
    });
  });

  it("reports a cloud start failure without stopping", async () => {
    const mediaId = Promise.reject(new Error("no access"));
    const { open, issues } = setup({ cloud: true, mediaId });
    await open();
    await new Promise((done) => setTimeout(done, 0));
    expect(issues).toEqual([{ failure: sinkMessages.cloudStart("no access"), stop: false }]);
  });

  it("drops the memory copy past the cap when the cloud has it, and says so if the upload fails", async () => {
    const { open, upload, issues } = setup({ disk: false, cloud: true, limitBytes: 5 });
    const sink = await open();
    sink.write(chunk(4));
    sink.write(chunk(4));
    expect(issues).toEqual([]);
    upload.finishError = new Error("offline");
    expect(await sink.finish()).toEqual({
      kind: "none",
      failure: sinkMessages.cloudFailedLost("offline"),
    });
  });

  it("abandon closes the disk copy so it can be recovered, and ignores later chunks", async () => {
    const { open, writer, upload } = setup({ cloud: true });
    const sink = await open();
    sink.write(chunk(3));
    await sink.abandon();
    sink.write(chunk(3));
    expect(writer.close).toHaveBeenCalled();
    expect(writer.abort).not.toHaveBeenCalled();
    expect(upload.bytes).toBe(3);
    expect(upload.finish).not.toHaveBeenCalled();
  });
});
