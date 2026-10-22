import { decodeProjectFile } from "../../packages/contracts/src/project.ts";
import { paintPicture } from "../../packages/platform-browser/src/picture.ts";
import { processPicture } from "../../packages/platform-browser/src/color-processing.ts";
import { LocalMediaReader } from "../../packages/platform-browser/src/preview.ts";
import { renderWebM } from "../../packages/platform-browser/src/export.ts";
import { BrowserProjectStore } from "../../packages/platform-browser/src/storage.ts";
const fx = (type, params = {}, id = type) => ({ id, type, enabled: true, params });
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const near = (a, b, t = 1) => a.every((v, i) => Math.abs(v - b[i]) <= t);
const surface = (w, h = w) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
const sample = (c, x, y) => [...c.getContext("2d").getImageData(x, y, 1, 1).data];
export async function verifySpatialEffects() {
  const source = surface(64),
    sx = source.getContext("2d");
  sx.fillStyle = "rgb(64,64,64)";
  sx.fillRect(8, 8, 24, 48);
  sx.fillStyle = "rgb(192,192,192)";
  sx.fillRect(32, 8, 24, 48);
  const original = sx.getImageData(0, 0, 64, 64).data;
  const sharp = await processPicture(source, 64, 64, [fx("sharpen", { amount: 10 })], undefined);
  const sharpPixels = sharp.getContext("2d").getImageData(0, 0, 64, 64).data;
  assert(
    original.every((v, i) => i % 4 !== 3 || v === sharpPixels[i]),
    "Sharpen changed alpha",
  );
  assert(
    sample(sharp, 31, 32)[0] < 64 && sample(sharp, 32, 32)[0] > 192,
    "Sharpen edge did not increase contrast",
  );
  const blurred = await processPicture(source, 64, 64, [fx("blur", { radius: 1.5 })], undefined);
  const halo = sample(blurred, 6, 32);
  assert(
    halo[3] > 0 && halo[3] < 128 && Math.abs(halo[0] - 64) < 4,
    "Blur fringe or alpha mismatch",
  );
  const gradient = surface(64);
  const gc = gradient.getContext("2d"),
    data = gc.createImageData(64, 64);
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) data.data.set([x * 4, y * 4, 0, 255], (y * 64 + x) * 4);
  gc.putImageData(data, 0, 0);
  const blocks = await processPicture(gradient, 64, 64, [fx("pixelate", { scale: 8 })], undefined);
  assert(near(sample(blocks, 7, 9), sample(blocks, 12, 9), 0), "Pixel block alignment");
  assert(!near(sample(blocks, 13, 9), sample(blocks, 14, 9), 0), "Pixel block boundary");
  const overlay = surface(20),
    oc = overlay.getContext("2d");
  oc.fillStyle = "red";
  oc.fillRect(0, 0, 20, 20);
  oc.clearRect(8, 8, 4, 4);
  const png = await new Promise((resolve) => overlay.toBlob(resolve, "image/png"));
  const resource = {
    file: new File([png], "alpha-overlay.png", { type: "image/png" }),
    state: "available",
    detail: "synthetic alpha",
  };
  const file = decodeProjectFile({
    revision: 0,
    project: {
      id: "spatial_" + crypto.randomUUID(),
      name: "Spatial effects verification",
      settings: { width: 320, height: 180, frameRate: { numerator: 10, denominator: 1 } },
      media: [{ id: "image", path: "alpha-overlay.png", kind: "image", width: 20, height: 20 }],
      videoTracks: [
        {
          id: "track",
          kind: "video",
          name: "Overlay",
          clips: [
            {
              id: "clip",
              name: "Styled overlay",
              duration: 1,
              content: { media: { mediaID: "image" } },
              video: {
                transform: { scale: 0.5 },
                crop: { left: 0.25 },
                effects: [
                  fx("dropShadow", {
                    distance: 60,
                    angle: 135,
                    blur: 0,
                    opacity: 100,
                    color: { r: 1, g: 1, b: 1, a: 1 },
                  }),
                  fx("border", { width: 12, color: { r: 0, g: 1, b: 0, a: 1 } }),
                  fx("roundedCorners", { radius: 30 }),
                ],
              },
            },
          ],
        },
      ],
    },
  });
  const reader = await LocalMediaReader.open(resource.file, "image"),
    canvas = surface(320, 180);
  try {
    await paintPicture(canvas.getContext("2d"), file.project, 0, async () => reader);
    const style = {
      hole: sample(canvas, 160, 90),
      border: sample(canvas, 136, 90),
      outside: sample(canvas, 134, 90),
      shadow: sample(canvas, 210, 100),
      empty: sample(canvas, 210, 40),
      corner: sample(canvas, 136, 43),
    };
    assert(near(style.hole, [0, 255, 0, 255]), "Rectangular border backing semantics");
    assert(near(style.border, [0, 255, 0, 255]), "Crop border position");
    assert(near(style.outside, [0, 0, 0, 255]), "Border width");
    assert(near(style.shadow, [255, 255, 255, 255]), "Post-transform shadow offset");
    assert(near(style.empty, [0, 0, 0, 255]), "Opaque shadow rectangle");
    assert(near(style.corner, [0, 0, 0, 255]), "Rounded cropped corner");
    const rounded = {
      ...file.project,
      videoTracks: file.project.videoTracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({
          ...c,
          video: { ...c.video, effects: [fx("roundedCorners", { radius: 30 })] },
        })),
      })),
    };
    await paintPicture(canvas.getContext("2d"), rounded, 0, async () => reader);
    assert(near(sample(canvas, 138, 45), [0, 0, 0, 255]), "Round-before-transform crop mask");
    assert(near(sample(canvas, 145, 50), [255, 0, 0, 255]), "Rounded corner clipped interior");
    const variant = (video) => ({
      ...file.project,
      videoTracks: file.project.videoTracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) => ({ ...c, video: { ...c.video, ...video } })),
      })),
    });
    await paintPicture(canvas.getContext("2d"), variant({ opacity: 0.5 }), 0, async () => reader);
    assert(
      near(sample(canvas, 180, 90), [128, 0, 0, 255]),
      "Opacity applied separately to foreground and shadow",
    );
    await paintPicture(
      canvas.getContext("2d"),
      variant({
        transform: { scale: 0.5, rotation: 90 },
        effects: [
          fx("dropShadow", {
            angle: 0,
            distance: 60,
            blur: 0,
            opacity: 100,
            color: { r: 1, g: 1, b: 1, a: 1 },
          }),
        ],
      }),
      0,
      async () => reader,
    );
    const rotated = { shadow: sample(canvas, 110, 100), above: sample(canvas, 160, 60) };
    assert(
      near(rotated.shadow, [255, 255, 255, 255]) && near(rotated.above, [0, 0, 0, 255]),
      "Shadow offset rotated with the source",
    );
    await paintPicture(
      canvas.getContext("2d"),
      variant({
        transform: { scale: 0.5, position: { x: -50 / 320, y: 0.5 } },
        crop: {},
        effects: [
          fx("dropShadow", {
            angle: 180,
            distance: 60,
            blur: 0,
            opacity: 100,
            color: { r: 1, g: 1, b: 1, a: 1 },
          }),
        ],
      }),
      0,
      async () => reader,
    );
    const offscreen = sample(canvas, 2, 90);
    assert(near(offscreen, [255, 255, 255, 255]), "Offscreen layer lost its visible shadow");
    await paintPicture(
      canvas.getContext("2d"),
      variant({
        effects: [
          fx("dropShadow", {
            distance: 60,
            angle: 135,
            blur: 12,
            opacity: 100,
            color: { r: 1, g: 1, b: 1, a: 1 },
          }),
        ],
      }),
      0,
      async () => reader,
    );
    const soft = {
      near: sample(canvas, 210, 100),
      far: sample(canvas, 230, 100),
      hole: sample(canvas, 160, 90),
    };
    assert(
      soft.near[0] > 0 &&
        soft.near[0] < 255 &&
        near(soft.far, [0, 0, 0, 255]) &&
        soft.hole[0] < 100,
      "Soft alpha shadow shape",
    );
    const borders = [];
    for (const size of [216, 432]) {
      const project = decodeProjectFile({
        revision: 0,
        project: {
          settings: { width: size, height: size },
          videoTracks: [
            {
              id: "t",
              kind: "video",
              clips: [
                {
                  id: "c",
                  duration: 1,
                  content: { solid: { color: { r: 1, g: 0, b: 0, a: 1 } } },
                  video: {
                    transform: { scale: 0.5 },
                    effects: [fx("border", { width: 54, color: { r: 0, g: 1, b: 0, a: 1 } })],
                  },
                },
              ],
            },
          ],
        },
      }).project;
      const output = surface(size);
      await paintPicture(output.getContext("2d"), project, 0, async () => {
        throw Error("solid requested media");
      });
      const edge = size / 4,
        b = (size / 1080) * 54;
      const inside = sample(output, Math.ceil(edge - b) + 1, size / 2),
        outside = sample(output, Math.floor(edge - b) - 2, size / 2);
      assert(
        near(inside, [0, 255, 0, 255]) && near(outside, [0, 0, 0, 255]),
        "Resolution-scaled border",
      );
      borders.push({ size, inside, outside });
    }
    // An alpha fixture with animated source blur, sharpen and pixelate exercises the shared export path.
    const animated = {
      revision: 0,
      project: {
        ...file.project,
        id: "animated_" + crypto.randomUUID(),
        name: "Animated spatial effects",
        videoTracks: file.project.videoTracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => ({
            ...c,
            video: {
              ...c.video,
              effects: [
                fx("sharpen", { amount: 3 }),
                fx("blur", { radius: 0 }),
                fx("pixelate", { scale: 32 }),
                ...c.video.effects,
              ],
            },
            keyframes: {
              "video.effects.blur.radius": [
                { time: 0, value: 0, interpolation: "linear" },
                { time: 1, value: 100 },
              ],
            },
          })),
        })),
      },
    };
    const previews = [];
    for (const time of [0, 0.5]) {
      await paintPicture(canvas.getContext("2d"), animated.project, time, async () => reader);
      previews.push({ time, center: sample(canvas, 160, 90), edge: sample(canvas, 202, 90) });
    }
    assert(
      !near(previews[0].center, previews[1].center, 8),
      "Animated blur did not change the alpha hole",
    );
    const blob = await renderWebM(
      animated.project,
      async () => resource,
      new AbortController().signal,
      () => {},
    );
    const encoded = await LocalMediaReader.open(
      new File([blob], "spatial.webm", { type: "video/webm" }),
      "video",
    );
    try {
      for (const entry of previews) {
        const frame = await encoded.frame(entry.time);
        canvas.getContext("2d").drawImage(frame.canvas, 0, 0);
        entry.encoded = sample(canvas, 160, 90);
        assert(near(entry.center, entry.encoded, 12), "Animated preview/export mismatch");
      }
    } finally {
      encoded.close();
    }
    const store = await BrowserProjectStore.open();
    try {
      await store.importProject(animated);
      await store.putResource(animated.project.id, "image", resource);
    } finally {
      store.close();
    }
    return {
      sharpen: [sample(sharp, 31, 32), sample(sharp, 32, 32)],
      halo,
      blocks: [sample(blocks, 7, 9), sample(blocks, 12, 9), sample(blocks, 14, 9)],
      style,
      rotated,
      offscreen,
      soft,
      borders,
      previews,
      bytes: blob.size,
      projectID: animated.project.id,
    };
  } finally {
    reader.close();
  }
}
