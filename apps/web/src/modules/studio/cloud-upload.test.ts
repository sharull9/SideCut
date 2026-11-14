import { describe, expect, it } from "vite-plus/test";
import { PART_BYTES, RecordingUpload, type CloudUploadTarget } from "./cloud-upload";

function target(failures = new Map<number, number>()) {
  const sent: { part: number; size: number }[] = [];
  const finished: [number, number][] = [];
  const value: CloudUploadTarget = {
    partUrl: async (part) => `part:${part}`,
    put: async (url, body) => {
      const part = Number(url.split(":")[1]);
      const left = failures.get(part) ?? 0;
      if (left) {
        failures.set(part, left - 1);
        throw new Error("offline");
      }
      sent.push({ part, size: body.size });
    },
    finish: async (bytes, parts) => {
      finished.push([bytes, parts]);
    },
    wait: async () => {},
  };
  return { value, sent, finished };
}
const chunk = (bytes: number) => new Blob([new Uint8Array(bytes)]);

describe("recording upload", () => {
  it("sends equal full parts while recording and the remainder last", async () => {
    const { value, sent, finished } = target();
    const upload = new RecordingUpload(value);
    upload.push(chunk(PART_BYTES - 10));
    upload.push(chunk(20));
    upload.push(chunk(PART_BYTES));
    await upload.finish();
    expect(sent).toEqual([
      { part: 1, size: PART_BYTES },
      { part: 2, size: PART_BYTES },
      { part: 3, size: 10 },
    ]);
    expect(finished).toEqual([[PART_BYTES * 2 + 10, 3]]);
  });

  it("retries a failed part with a fresh URL before giving up", async () => {
    const { value, sent } = target(new Map([[1, 2]]));
    const upload = new RecordingUpload(value);
    upload.push(chunk(5));
    await upload.finish();
    expect(sent).toEqual([{ part: 1, size: 5 }]);
  });

  it("reports a part that keeps failing and never completes the object", async () => {
    const { value, finished } = target(new Map([[1, 10]]));
    const upload = new RecordingUpload(value);
    upload.push(chunk(5));
    await expect(upload.finish()).rejects.toThrow("offline");
    expect(upload.failed).toBe(true);
    expect(finished).toEqual([]);
  });

  it("rejects an empty recording and pushes after finishing", async () => {
    const upload = new RecordingUpload(target().value);
    await expect(upload.finish()).rejects.toThrow("empty");
    expect(() => upload.push(chunk(1))).toThrow("finished");
  });
});
