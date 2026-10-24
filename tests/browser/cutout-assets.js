// Browser runtime checks for phases 101–105. Import via the development server /@fs/ path.
import {
  normalizeAsset,
  AssetLibrary,
  libraryState,
  validateSVG,
} from "../../packages/platform-browser/src/asset-library.ts";
import { LocalMediaReader } from "../../packages/platform-browser/src/preview.ts";
import {
  analyseCutout,
  compositeCutout,
  renderCutoutPNG,
} from "../../packages/platform-browser/src/cutout.ts";
import { cutoutSettings } from "../../packages/core/src/cutout.ts";
import { decodeProjectFile } from "../../packages/contracts/src/project.ts";
import { BrowserProjectStore } from "../../packages/platform-browser/src/storage.ts";
import { renderWebM } from "../../packages/platform-browser/src/export.ts";
import { paintPicture } from "../../packages/platform-browser/src/picture.ts";

const assert = (v, message) => {
  if (!v) throw new Error(message);
};
const pixel = (c, x, y) => [...c.getContext("2d").getImageData(x, y, 1, 1).data];
const canvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
export const animationData = {
  v: "5.13.0",
  w: 128,
  h: 128,
  fr: 30,
  ip: 0,
  op: 30,
  nm: "Synthetic red square",
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 1,
      nm: "Moving square",
      sw: 32,
      sh: 32,
      sc: "#ff0000",
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        a: { a: 0, k: [0, 0, 0] },
        s: { a: 0, k: [100, 100, 100] },
        p: {
          a: 1,
          k: [
            {
              t: 0,
              s: [8, 48, 0],
              e: [88, 48, 0],
              o: { x: 0.33, y: 0.33 },
              i: { x: 0.67, y: 0.67 },
            },
            { t: 30, s: [88, 48, 0] },
          ],
        },
      },
      ip: 0,
      op: 30,
      st: 0,
      bm: 0,
    },
  ],
};

export async function verifyAssets() {
  const meta = {
    provider: "local",
    providerID: "phase-104-svg",
    kind: "icon",
    name: "Verification icon",
    tags: ["synthetic", "red"],
    licenceClass: "creditNeeded",
    creditLine: "SideCut test fixture, CC0",
  };
  const svg = new File(
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect x="32" y="32" width="64" height="64" fill="red"/></svg>',
    ],
    "icon.svg",
    { type: "image/svg+xml" },
  );
  const entry = await normalizeAsset(svg, meta, new File(["CC0 synthetic fixture"], "LICENSE.txt"));
  assert(entry.normalised.type === "image/png", "SVG was not normalized");
  const lib = await AssetLibrary.open();
  await lib.put(entry);
  lib.close();
  const reopened = await AssetLibrary.open(),
    stored = await reopened.get(entry.asset.id);
  assert(
    stored.asset.creditLine === meta.creditLine &&
      stored.original.size === svg.size &&
      stored.licence.size > 0,
    "Library provenance lost on reopen",
  );
  assert(
    (await reopened.entries("synthetic red", "icon", "creditNeeded")).some(
      (e) => e.asset.id === entry.asset.id,
    ),
    "Search filters failed",
  );
  assert(libraryState({ asset: entry.asset }) === "missing file", "Missing state lost");
  let unsafe = false;
  try {
    validateSVG('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  } catch {
    unsafe = true;
  }
  assert(unsafe, "Active SVG accepted");
  let unsupported = false;
  try {
    await normalizeAsset(new File(["nonsense"], "bad.bin"), meta);
  } catch {
    unsupported = true;
  }
  assert(unsupported, "Unsupported image accepted");
  const lut = await normalizeAsset(
    new File(
      ["LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n"],
      "identity.cube",
    ),
    { ...meta, providerID: "phase-104-lut", kind: "lut" },
  );
  const fontURL = (
    await import("../../packages/platform-browser/node_modules/@fontsource/anton/files/anton-latin-400-normal.woff2?url")
  ).default;
  const font = await normalizeAsset(
    new File([await (await fetch(fontURL)).blob()], "Anton-Regular.woff2"),
    { ...meta, providerID: "phase-104-font", kind: "font" },
    new File(
      [
        (await import("../../packages/platform-browser/node_modules/@fontsource/anton/LICENSE?raw"))
          .default,
      ],
      "OFL.txt",
    ),
  );
  assert(font.fontFamily && font.licence, "Font/companion not retained");
  const animation = await normalizeAsset(
    new File([JSON.stringify(animationData)], "square.json", { type: "application/json" }),
    { ...meta, providerID: "phase-105-lottie", kind: "sticker" },
  );
  await reopened.put(animation);
  reopened.close();
  const reader = await LocalMediaReader.open(animation.normalised, "image"),
    c = canvas(128, 128);
  const samples = [];
  for (const time of [0, 0.5, 0.99, 0]) {
    const frame = await reader.frame(time);
    c.getContext("2d").clearRect(0, 0, 128, 128);
    c.getContext("2d").drawImage(frame.canvas, 0, 0);
    samples.push({
      time,
      left: pixel(c, 16, 60),
      middle: pixel(c, 64, 60),
      right: pixel(c, 104, 60),
      corner: pixel(c, 0, 0),
    });
  }
  assert(
    samples[0].left[0] === 255 && samples[0].left[3] === 255 && samples[0].corner[3] === 0,
    "Lottie alpha/first frame wrong",
  );
  assert(
    samples[1].middle[0] === 255 && samples[1].left[3] === 0,
    "Lottie timeline did not advance",
  );
  assert(
    JSON.stringify(samples[0].left) === JSON.stringify(samples[3].left),
    "Random seek did not restore first frame",
  );
  reader.close();
  const project = decodeProjectFile({
    revision: 0,
    project: {
      id: "prj_assets_verification",
      settings: { width: 128, height: 128, frameRate: { numerator: 10, denominator: 1 } },
      media: [
        { id: "anim", kind: "image", path: "square.json", duration: 1, asset: animation.asset },
      ],
      videoTracks: [
        {
          id: "base",
          kind: "video",
          clips: [
            { id: "blue", content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } }, duration: 1 },
          ],
        },
        {
          id: "top",
          kind: "video",
          clips: [{ id: "sticker", content: { media: { mediaID: "anim" } }, duration: 1 }],
        },
      ],
    },
  });
  const store = await BrowserProjectStore.open();
  await store.importProject(project);
  const round = await store.load(project.project.id);
  assert(round.project.media[0].asset.creditLine === meta.creditLine, "Project provenance lost");
  store.close();
  const webm = await renderWebM(
    project.project,
    async () => ({ file: animation.normalised, state: "available", detail: "Synthetic" }),
    new AbortController().signal,
    () => {},
  );
  const decoded = await LocalMediaReader.open(
    new File([webm], "animation.webm", { type: "video/webm" }),
    "video",
    128,
  );
  const frame = await decoded.frame(0.5);
  c.getContext("2d").drawImage(frame.canvas, 0, 0);
  const exported = { middle: pixel(c, 64, 60), corner: pixel(c, 0, 0) };
  decoded.close();
  assert(
    exported.middle[0] > 200 && exported.middle[2] < 40 && exported.corner[2] > 200,
    "Export alpha/timing differs from preview",
  );
  return {
    libraryID: entry.asset.id,
    staticPNG: entry.normalised.size,
    lutBytes: lut.normalised.size,
    fontFamily: font.fontFamily,
    lottieSamples: samples,
    exported,
    exportBytes: webm.size,
  };
}

export async function verifyVideoCutout() {
  const blob = await (
    await fetch(
      "/@fs/C:/sharull/coding/personal/side-cut/tests/fixtures/cutout/person-microphone.jpg",
    )
  ).blob();
  const file = new File([blob], "person-microphone.jpg", { type: "image/jpeg" });
  const cutout = cutoutSettings({
    edgeFeather: 2,
    choke: 1,
    repairMasks: [
      {
        shape: "roundedRectangle",
        mode: "include",
        rect: { x: 0.37, y: 0.49, width: 0.12, height: 0.28 },
        cornerRadius: 6,
        feather: 1,
      },
    ],
  });
  const project = decodeProjectFile({
    revision: 0,
    project: {
      id: "prj_cutout_pip",
      settings: { width: 320, height: 180, frameRate: { numerator: 5, denominator: 1 } },
      media: [{ id: "person", kind: "image", path: file.name }],
      videoTracks: [
        {
          id: "base",
          kind: "video",
          clips: [
            { id: "blue", content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } }, duration: 1 },
          ],
        },
        {
          id: "top",
          kind: "video",
          clips: [
            {
              id: "person-clip",
              content: { media: { mediaID: "person" } },
              duration: 1,
              video: {
                cutout,
                transform: { position: { x: 0.7, y: 0.6 }, scale: 0.7, rotation: 12 },
                crop: { left: 0.05, top: 0, right: 0, bottom: 0 },
              },
            },
          ],
        },
      ],
    },
  }).project;
  const resource = async () => ({ file, state: "available", detail: "Licensed CC BY 2.0 fixture" });
  const r = await LocalMediaReader.open(file, "image"),
    preview = canvas(320, 180);
  await paintPicture(preview.getContext("2d"), project, 0.4, async () => r);
  r.close();
  const webm = await renderWebM(project, resource, new AbortController().signal, () => {});
  const decoder = await LocalMediaReader.open(
      new File([webm], "cutout.webm", { type: "video/webm" }),
      "video",
      320,
    ),
    decoded = canvas(320, 180);
  const f = await decoder.frame(0.4);
  decoded.getContext("2d").drawImage(f.canvas, 0, 0);
  decoder.close();
  const a = preview.getContext("2d").getImageData(0, 0, 320, 180).data,
    b = decoded.getContext("2d").getImageData(0, 0, 320, 180).data;
  let error = 0;
  for (let i = 0; i < a.length; i += 4)
    for (let c = 0; c < 3; c++) error += Math.abs(a[i + c] - b[i + c]);
  const mae = error / (320 * 180 * 3);
  assert(mae < 15, "Cutout PiP preview/export differ beyond 15 RGB levels");
  window.cutoutPipImages = { preview: preview.toDataURL(), exported: decoded.toDataURL() };
  const full = decodeProjectFile({
    revision: 0,
    project: {
      settings: { width: 320, height: 240, frameRate: { numerator: 5, denominator: 1 } },
      media: [{ id: "p", kind: "image", path: file.name }],
      videoTracks: [
        { kind: "video", clips: [{ content: { media: { mediaID: "p" } }, duration: 1 }] },
      ],
    },
  }).project;
  const video = await renderWebM(full, resource, new AbortController().signal, () => {});
  const t = performance.now(),
    matte = await analyseCutout(
      new File([video], "person-video.webm", { type: "video/webm" }),
      "video",
      1,
      new AbortController().signal,
      () => {},
    );
  const ms = performance.now() - t;
  assert(matte.frames.length === 5, "Video matte lost frame timestamps");
  return {
    mae,
    exportBytes: webm.size,
    videoFrames: matte.frames.map((frame) => ({
      timestamp: frame.timestamp,
      duration: frame.duration,
    })),
    analysisMs: ms,
    analysisFPS: matte.frames.length / (ms / 1000),
  };
}

export async function verifyAnimatedImage() {
  const reports = {};
  for (const ext of ["gif", "webp", "apng"]) {
    const blob = await (
      await fetch(
        `/@fs/C:/sharull/coding/personal/side-cut/tests/fixtures/cutout/alpha-sticker.${ext}`,
      )
    ).blob();
    const entry = await normalizeAsset(
      new File([blob], `alpha-sticker.${ext}`, {
        type: ext === "apng" ? "image/png" : `image/${ext}`,
      }),
      {
        provider: "local",
        providerID: "phase-105-gif",
        kind: "sticker",
        licenceClass: "noCredit",
      },
    );
    assert(entry.asset.duration === 1, "GIF frame durations lost");
    const r = await LocalMediaReader.open(entry.normalised, "image"),
      c = canvas(64, 64),
      results = [];
    for (const time of [0, 0.6, 0]) {
      const f = await r.frame(time);
      c.getContext("2d").clearRect(0, 0, 64, 64);
      c.getContext("2d").drawImage(f.canvas, 0, 0);
      results.push({
        time,
        corner: pixel(c, 0, 0),
        red: pixel(c, time === 0.6 ? 36 : 12, 20),
        cleared: pixel(c, time === 0.6 ? 12 : 36, 20),
      });
    }
    r.close();
    assert(
      results.every(
        (v) => v.corner[3] === 0 && v.red[0] > 240 && v.red[3] === 255 && v.cleared[3] === 0,
      ),
      "GIF alpha or random access failed",
    );
    reports[ext] = { duration: entry.asset.duration, results };
  }
  return reports;
}

export async function verifyCutout() {
  const blob = await (
    await fetch(
      "/@fs/C:/sharull/coding/personal/side-cut/tests/fixtures/cutout/person-microphone.jpg",
    )
  ).blob();
  const file = new File([blob], "person-microphone.jpg", { type: "image/jpeg" });
  const t = performance.now();
  const matte = await analyseCutout(file, "image", 1, new AbortController().signal, () => {});
  const ms = performance.now() - t;
  const reader = await LocalMediaReader.open(file, "image"),
    frame = await reader.frame(0);
  const settings = cutoutSettings({ edgeFeather: 0, repairMasks: [] });
  const out = await compositeCutout(frame.canvas, frame.width, frame.height, matte, 0, settings);
  const pixels = out.getContext("2d").getImageData(0, 0, out.width, out.height).data;
  let foreground = 0,
    background = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > 200) foreground++;
    if (pixels[i] < 20) background++;
  }
  assert(
    foreground > 1000 && background > 1000,
    "Person segmentation did not separate subject and background",
  );
  const repair = cutoutSettings({
    edgeFeather: 0,
    repairMasks: [
      {
        shape: "rectangle",
        mode: "include",
        rect: { x: 0, y: 0, width: 0.1, height: 0.1 },
        cornerRadius: 0,
        feather: 0,
      },
      {
        shape: "ellipse",
        mode: "exclude",
        rect: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
        cornerRadius: 0,
        feather: 0,
      },
    ],
  });
  const fixed = await compositeCutout(frame.canvas, frame.width, frame.height, matte, 0, repair);
  const alphaPNG = await renderCutoutPNG(file, "image", 0, repair),
    pngImage = await createImageBitmap(alphaPNG),
    pngCanvas = canvas(frame.width, frame.height);
  pngCanvas.getContext("2d").drawImage(pngImage, 0, 0);
  pngImage.close();
  assert(
    pixel(pngCanvas, Math.floor(frame.width * 0.05), Math.floor(frame.height * 0.05))[3] === 255 &&
      pixel(pngCanvas, Math.floor(frame.width * 0.5), Math.floor(frame.height * 0.5))[3] === 0,
    "PNG export lost repaired alpha",
  );
  assert(
    pixel(fixed, Math.floor(frame.width * 0.05), Math.floor(frame.height * 0.05))[3] === 255,
    "Include repair failed",
  );
  assert(
    pixel(fixed, Math.floor(frame.width * 0.5), Math.floor(frame.height * 0.5))[3] === 0,
    "Exclude repair failed",
  );
  let missing = false;
  try {
    await compositeCutout(frame.canvas, frame.width, frame.height, matte, 2, settings);
  } catch {
    missing = true;
  }
  assert(missing, "Incomplete matte silently held");
  const cancelled = new AbortController();
  cancelled.abort();
  let aborted = false;
  try {
    await analyseCutout(file, "image", 1, cancelled.signal, () => {});
  } catch {
    aborted = true;
  }
  assert(aborted, "Cancelled job returned a result");
  window.cutoutImages = {
    original: frame.canvas.toDataURL?.() ?? null,
    cutout: out.toDataURL(),
    repaired: fixed.toDataURL(),
  };
  reader.close();
  return {
    ms,
    frames: matte.frames.length,
    matteWidth: matte.width,
    matteHeight: matte.height,
    width: frame.width,
    height: frame.height,
    foreground,
    background,
    includeRepair: true,
    excludeRepair: true,
    incompleteRejected: true,
    cancelled: true,
    alphaPNGBytes: alphaPNG.size,
  };
}
