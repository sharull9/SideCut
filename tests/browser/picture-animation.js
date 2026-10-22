import { decodeProjectFile } from "../../packages/contracts/src/project.ts";
import { ProjectCoordinator } from "../../packages/core/src/coordinator.ts";
import { paintPicture } from "../../packages/platform-browser/src/picture.ts";
import { LocalMediaReader } from "../../packages/platform-browser/src/preview.ts";
import { renderWebM } from "../../packages/platform-browser/src/export.ts";

export async function verifyPictureAnimation() {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const source = document.createElement("canvas");
  source.width = 320;
  source.height = 180;
  const sx = source.getContext("2d");
  sx.fillStyle = "red";
  sx.fillRect(0, 0, 160, 180);
  sx.fillStyle = "lime";
  sx.fillRect(160, 0, 160, 180);
  const png = await new Promise((resolve) => source.toBlob(resolve, "image/png"));
  const resource = {
    file: new File([png], "split.png", { type: "image/png" }),
    state: "available",
    detail: "Synthetic image",
  };
  const file = decodeProjectFile({
    revision: 0,
    project: {
      id: "animation_" + crypto.randomUUID(),
      name: "Animated crop verification",
      settings: { width: 320, height: 180 },
      media: [{ id: "image", path: "split.png", kind: "image", width: 320, height: 180 }],
      videoTracks: [
        {
          id: "base",
          kind: "video",
          name: "Blue",
          clips: [
            { id: "blue", duration: 2, content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } } },
          ],
        },
        {
          id: "picture",
          kind: "video",
          name: "Image",
          clips: [
            {
              id: "imageClip",
              duration: 2,
              content: { media: { mediaID: "image" } },
              video: {
                crop: { left: 0.5 },
                transform: { position: { x: 0.25, y: 0.5 } },
                opacity: 0.5,
              },
              keyframes: {
                "video.transform.position": [
                  { time: 0, value: { x: 0.25, y: 0.5 }, interpolation: "linear" },
                  { time: 1, value: { x: 0.75, y: 0.5 } },
                ],
                "video.opacity": [
                  { time: 0, value: 0.5, interpolation: "linear" },
                  { time: 1, value: 1 },
                ],
              },
            },
          ],
        },
      ],
    },
  });
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  const reader = await LocalMediaReader.open(resource.file, "image");
  const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
  const near = (actual, expected, tolerance = 1) =>
    actual.every((v, i) => Math.abs(v - expected[i]) <= tolerance);
  const samples = [];
  try {
    for (const [time, x, expected] of [
      [0, 120, [0, 128, 127]],
      [0.5, 200, [0, 191, 64]],
      [1, 280, [0, 255, 0]],
    ]) {
      await paintPicture(ctx, file.project, time, async () => reader);
      const value = pixel(x, 90);
      assert(near(value, expected), "Preview crop/opacity mismatch at " + time);
      assert(near(pixel(40, 90), [0, 0, 255]), "Crop was recentered at " + time);
      samples.push({ time, x, preview: value });
    }
    const blob = await renderWebM(
      file.project,
      async () => resource,
      new AbortController().signal,
      () => {},
    );
    const encoded = await LocalMediaReader.open(
      new File([blob], "animated.webm", { type: "video/webm" }),
      "video",
    );
    try {
      for (const sample of samples) {
        const frame = await encoded.frame(sample.time);
        ctx.drawImage(frame.canvas, 0, 0);
        const value = pixel(sample.x, 90);
        assert(near(value, sample.preview, 12), "Encoded frame differs at " + sample.time);
        sample.encoded = value;
      }
    } finally {
      encoded.close();
    }
    const c = new ProjectCoordinator(file);
    c.apply({
      commands: [
        {
          zoomToRegion: { clipID: "imageClip", rect: { x: 0.5, y: 0.25, width: 0.5, height: 0.5 } },
        },
        {
          updateClip: {
            clipID: "imageClip",
            patch: {
              video: { crop: { left: 0 }, opacity: 1 },
              keyframes: { "video.opacity": null },
            },
          },
        },
      ],
    });
    await paintPicture(ctx, c.getSnapshot().project, 0, async () => reader);
    assert(
      near(pixel(10, 90), [0, 255, 0]) && near(pixel(300, 90), [0, 255, 0]),
      "Selected source region did not fit the canvas",
    );
    return { bytes: blob.size, samples, region: "right half fills canvas", file, resource };
  } finally {
    reader.close();
  }
}
