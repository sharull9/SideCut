import { decodeProjectFile } from "../../packages/contracts/src/project.ts";
import { paintPicture } from "../../packages/platform-browser/src/picture.ts";
import { processPicture } from "../../packages/platform-browser/src/color-processing.ts";
import { renderWebM } from "../../packages/platform-browser/src/export.ts";
import { LocalMediaReader } from "../../packages/platform-browser/src/preview.ts";
import { createLUTLoader } from "../../packages/platform-browser/src/lut.ts";
import { BrowserProjectStore } from "../../packages/platform-browser/src/storage.ts";
const fx = (id, type, params = {}) => ({ id, type, enabled: true, params });
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
export const cube = "LUT_3D_SIZE 2\n1 1 1\n0 1 1\n1 0 1\n0 0 1\n1 1 0\n0 1 0\n1 0 0\n0 0 0";
export async function verifyEffects() {
  const source = document.createElement("canvas");
  source.width = 320;
  source.height = 180;
  const sx = source.getContext("2d");
  sx.fillStyle = "rgb(64,128,192)";
  sx.fillRect(0, 0, 320, 180);
  const png = await new Promise((resolve) => source.toBlob(resolve, "image/png"));
  const resources = new Map([
    [
      "image",
      {
        file: new File([png], "patch.png", { type: "image/png" }),
        state: "available",
        detail: "patch",
      },
    ],
    [
      "lut:invert.cube",
      { file: new File([cube], "invert.cube"), state: "available", detail: "invert" },
    ],
  ]);
  const resource = async (id) => resources.get(id) ?? null;
  const lut = createLUTLoader(resource);
  const file = decodeProjectFile({
    revision: 0,
    project: {
      id: "effects_" + crypto.randomUUID(),
      name: "Effects verification",
      settings: { width: 320, height: 180, frameRate: { numerator: 10, denominator: 1 } },
      media: [
        {
          id: "image",
          path: "patch.png",
          kind: "image",
          width: 320,
          height: 180,
          look: [fx("look", "colorAdjust", { saturation: -100 })],
        },
      ],
      videoTracks: [
        {
          id: "track",
          kind: "video",
          name: "Color",
          clips: [
            {
              id: "clip",
              name: "Graded patch",
              duration: 1,
              content: { media: { mediaID: "image" } },
              video: {
                effects: [
                  fx("adjust", "colorAdjust"),
                  fx("hsl", "hsl"),
                  fx("wheels", "colorWheels"),
                  fx("lut", "lut", { path: "invert.cube", intensity: 0.25 }),
                  fx("vignette", "vignette", { amount: -100, size: 0, feather: 100 }),
                ],
              },
              keyframes: {
                "video.effects.adjust.exposure": [
                  { time: 0, value: 0, interpolation: "linear" },
                  { time: 1, value: 1 },
                ],
              },
            },
          ],
        },
      ],
    },
  });
  const reader = await LocalMediaReader.open(resources.get("image").file, "image");
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
  const near = (a, b, tolerance = 1) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
  const samples = [];
  try {
    for (const time of [0, 0.5]) {
      await paintPicture(ctx, file.project, time, async () => reader, undefined, lut);
      const center = pixel(160, 90),
        corner = pixel(0, 0);
      const y = (64 * 0.2126 + 128 * 0.7152 + 192 * 0.0722) / 255;
      const expected = Math.round((y * 2 ** (time / 2.2) * 0.5 + 0.25) * 255);
      assert(
        near(center, [expected, expected, expected, 255]),
        "LUT intensity, animation or effect ordering",
      );
      assert(near(corner, [0, 0, 0, 255]), "Vignette corner");
      samples.push({ time, center, corner });
    }
    const blob = await renderWebM(file.project, resource, new AbortController().signal, () => {});
    const encoded = await LocalMediaReader.open(
      new File([blob], "effects.webm", { type: "video/webm" }),
      "video",
    );
    try {
      for (const sample of samples) {
        const frame = await encoded.frame(sample.time);
        ctx.drawImage(frame.canvas, 0, 0);
        sample.encoded = pixel(160, 90);
        assert(near(sample.encoded, sample.center, 8), "Export differs from preview");
      }
    } finally {
      encoded.close();
    }
    const missing = {
      ...file.project,
      media: file.project.media.map((m) => ({ ...m, look: [] })),
      videoTracks: file.project.videoTracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({
          ...c,
          video: { effects: [fx("missing", "lut", { path: "missing.cube" })] },
        })),
      })),
    };
    let error;
    try {
      await renderWebM(missing, resource, new AbortController().signal, () => {});
    } catch (cause) {
      error = cause.message;
    }
    assert(error?.includes("missing.cube"), "Missing LUT did not reject export");
    // The processor must retain alpha and floating point intermediates until the final raster.
    sx.clearRect(0, 0, 320, 180);
    sx.fillStyle = "rgba(255,128,64,0.5)";
    sx.fillRect(0, 0, 320, 180);
    const processed = await processPicture(
      source,
      320,
      180,
      [
        fx("gain", "colorWheels", { highlightsBrightness: 100 }),
        fx("undo", "colorWheels", { highlightsBrightness: -80 }),
      ],
      undefined,
    );
    ctx.clearRect(0, 0, 320, 180);
    ctx.drawImage(processed, 0, 0);
    const alpha = pixel(160, 90);
    assert(near(alpha, [255, 128, 64, 128], 2), "Alpha or intermediate clipping");
    const store = await BrowserProjectStore.open();
    try {
      await store.importProject(file);
      for (const [id, value] of resources) await store.putResource(file.project.id, id, value);
    } finally {
      store.close();
    }
    return { samples, bytes: blob.size, missing: error, alpha, projectID: file.project.id };
  } finally {
    reader.close();
  }
}
