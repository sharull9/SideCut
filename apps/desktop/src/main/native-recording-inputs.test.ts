import { describe, expect, it } from "vite-plus/test";
import assert from "node:assert/strict";
import {
  assembleNativeInputs,
  nativeDevices,
  nativeInputs,
  parseNativeDevices,
} from "./native-recording-inputs.ts";

const listing = `[dshow @ 123] "Camera" (video)
[dshow @ 123]   Alternative name "@device_pnp_\\camera1"
[dshow @ 123] "Mic" (audio)
[dshow @ 123]   Alternative name "@device_cm_mic1"
`;
const request = { projectID: "project", encoder: "auto" as const };

describe("native capture inputs", () => {
  it("uses stable opaque alternative identifiers and supports older listings", () => {
    const devices = parseNativeDevices(listing);
    assert.ok(devices[0]);
    expect(devices.map(({ name, kind }) => ({ name, kind }))).toEqual([
      { name: "Camera", kind: "camera" },
      { name: "Mic", kind: "microphone" },
    ]);
    expect(devices[0].id).toMatch(/^[a-f0-9]{64}$/);
    expect(parseNativeDevices(listing.replace('"Camera"', '"Renamed"'))[0]?.id).toBe(devices[0].id);
    expect(
      parseNativeDevices('[dshow @ 1] DirectShow audio devices\n[dshow @ 1]  "Legacy mic"')[0]
        ?.kind,
    ).toBe("microphone");
  });

  it("omits ambiguous or unsafe names", () => {
    const devices = parseNativeDevices(
      '[dshow @ 1] "Dup" (video)\n[dshow @ 1] "Dup" (video)\n[dshow @ 1] "bad:audio=other" (video)',
    );
    expect(devices).toEqual([]);
  });

  it("starts audio first and maps selected camera and microphone explicitly", () => {
    const [camera, mic] = parseNativeDevices(listing);
    assert.ok(camera && mic);
    const input = assembleNativeInputs(
      { ...request, source: "camera", deviceID: camera.id, microphoneID: mic.id },
      [camera, mic],
    );
    expect(input).toEqual({
      audio: true,
      video: true,
      args: [
        "-thread_queue_size",
        "32",
        "-f",
        "dshow",
        "-i",
        "audio=@device_cm_mic1",
        "-thread_queue_size",
        "4",
        "-f",
        "dshow",
        "-i",
        "video=@device_pnp_\\camera1",
        "-map",
        "1:v:0",
        "-map",
        "0:a:0",
      ],
    });
    expect(
      assembleNativeInputs({ ...request, source: "screen", microphoneID: mic.id }, [
        mic,
      ]).args.slice(-4),
    ).toEqual(["-map", "1:v:0", "-map", "0:a:0"]);
    expect(assembleNativeInputs({ ...request, source: "screen" }, []).args.slice(-2)).toEqual([
      "-map",
      "0:v:0",
    ]);
    expect(
      assembleNativeInputs({ ...request, source: "microphone", deviceID: mic.id }, [mic]),
    ).toMatchObject({ video: false, audio: true, args: expect.arrayContaining(["0:a:0"]) });
  });

  it("rejects missing, stale, wrong-kind and ambiguous selections", () => {
    const [camera, mic] = parseNativeDevices(listing);
    assert.ok(camera && mic);
    for (const deviceID of [undefined, "stale", mic.id]) {
      expect(() =>
        assembleNativeInputs({ ...request, source: "camera", ...(deviceID ? { deviceID } : {}) }, [
          camera,
          mic,
        ]),
      ).toThrow(/missing or unavailable/);
    }
    expect(() =>
      assembleNativeInputs({ ...request, source: "camera", deviceID: camera.id }, [camera, camera]),
    ).toThrow(/missing or unavailable/);
    expect(() =>
      assembleNativeInputs({ ...request, source: "screen", microphoneID: "stale" }, [mic]),
    ).toThrow(/missing or unavailable/);
  });

  it("rejects unsupported platforms or an unavailable enumerator", async () => {
    if (process.platform === "win32")
      await expect(nativeDevices("sidecut-no-such-ffmpeg")).rejects.toThrow(/Could not start/);
    else {
      await expect(nativeDevices("unused")).rejects.toThrow(/only supported on Windows/);
      await expect(nativeInputs("unused", { ...request, source: "screen" })).rejects.toThrow(
        /only supported on Windows/,
      );
    }
  });
});
