// Phases 097-100. Import through the development server's /@fs/ path.
import { decodeProjectFile, encodeProjectFile } from "../../packages/contracts/src/project.ts";
import { ProjectCoordinator } from "../../packages/core/src/coordinator.ts";
import { CardMotion, cardOf, cardProps } from "../../packages/core/src/section-cards.ts";
import { BUILT_IN_TEMPLATES } from "../../packages/core/src/templates.ts";
import { formatProject } from "../../packages/core/src/formats.ts";
import { paintPicture } from "../../packages/platform-browser/src/picture.ts";
import {
  drawSectionCard,
  ensureCardFonts,
} from "../../packages/platform-browser/src/section-card.ts";
import { BrowserProjectStore } from "../../packages/platform-browser/src/storage.ts";
import { renderWebM } from "../../packages/platform-browser/src/export.ts";
import { LocalMediaReader } from "../../packages/platform-browser/src/preview.ts";

const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const encode = (coordinator) => encodeProjectFile(coordinator.projectFile());
const noMedia = async () => {
  throw new Error("Synthetic fixture should not read media");
};
const pixel = (ctx, x, y) => [...ctx.getImageData(x, y, 1, 1).data];

export async function verifyReusableContent() {
  await ensureCardFonts();
  const props = cardProps({
    title: "The method",
    subtitle: "Measure the result",
    number: "02",
    total: 4,
    kicker: "Section",
  });
  const motion = CardMotion.of(4, 640, 360);
  const samples = {};
  const images = {};
  for (const time of [0, 0.2, motion.covered[0], 1.2, 2.0, motion.covered[1], 3.8, 4]) {
    const card = drawSectionCard(props, 640, 360, time, 4);
    const ctx = card.getContext("2d");
    const data = ctx.getImageData(0, 0, 640, 360).data;
    let opaque = 0,
      visible = 0,
      white = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 255) opaque++;
      if (data[i + 3] > 0) visible++;
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) white++;
    }
    samples[time.toFixed(4)] = { opaque, visible, white };
    if (time === 1.2) images.card = card.toDataURL();
  }
  assert(
    samples["0.0000"].visible === 0 && samples["4.0000"].visible === 0,
    "Card must be transparent at both ends",
  );
  assert(
    samples["1.2000"].opaque === 640 * 360 && samples["1.2000"].white > 200,
    "Hold must cover frame and draw the title",
  );
  const c = new ProjectCoordinator(
    decodeProjectFile({
      revision: 0,
      project: {
        id: `probe_reusable_${Date.now()}`,
        name: "Reusable content verification",
        settings: {
          width: 640,
          height: 360,
          frameRate: { numerator: 30, denominator: 1 },
          alternateFormats: [{ id: "portrait", name: "Portrait", width: 270, height: 480 }],
        },
        videoTracks: [
          {
            id: "background",
            name: "Background",
            kind: "video",
            clips: [
              {
                id: "blue",
                duration: 10,
                content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } },
              },
            ],
          },
        ],
        markers: [
          { id: "section", time: 2, name: "Method", kind: "section", note: "A measured example" },
        ],
      },
    }),
  );
  const initial = encode(c);
  c.apply({ commands: [{ addSectionCards: { kicker: "Section", mode: "insert" } }] });
  const inserted = c.getSnapshot().project;
  const clip = inserted.videoTracks.flatMap((t) => t.clips).find((v) => cardOf(v));
  const movedMarker = inserted.markers[0].time;
  assert(movedMarker > 2, "Inserted card must move its section marker");
  c.undo();
  assert(
    c.getSnapshot().project.videoTracks.length === 1 &&
      c.getSnapshot().project.markers[0].time === 2,
    "One undo removes card and restores marker",
  );
  c.apply({ commands: [{ addSectionCards: { kicker: "Section" } }] });
  const original = c.getSnapshot().project;
  const card = original.videoTracks.flatMap((t) => t.clips).find((v) => cardOf(v));
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  await paintPicture(ctx, original, card.start.seconds + 1.2, noMedia);
  images.composited = canvas.toDataURL();
  c.apply({
    commands: [
      {
        updateClip: {
          clipID: card.id,
          patch: { video: { formatOverrides: { portrait: { hidden: true } } } },
        },
      },
    ],
  });
  const beforePreview = encode(c);
  const portrait = formatProject(c.getSnapshot().project, "portrait");
  canvas.width = 270;
  canvas.height = 480;
  await paintPicture(ctx, portrait, card.start.seconds + 1.2, noMedia);
  const hiddenPixel = pixel(ctx, 135, 240);
  assert(
    hiddenPixel[2] === 255 && hiddenPixel[0] === 0,
    "Hidden card must reveal blue in portrait",
  );
  assert(beforePreview === encode(c), "Format preview cannot mutate the project");
  images.portraitHidden = canvas.toDataURL();
  const store = await BrowserProjectStore.open();
  try {
    await store.save(c.projectFile());
    const saved = await store.load(c.getSnapshot().project.id);
    assert(
      encodeProjectFile(saved) === encode(c),
      "Markers, cards and overrides must survive IndexedDB",
    );
  } finally {
    store.close();
  }
  const templates = new ProjectCoordinator(
    decodeProjectFile({ revision: 0, project: { settings: { width: 640, height: 360 } } }),
  );
  for (const at of [0, 5])
    templates.apply({
      commands: [
        {
          insertTemplate: {
            template: BUILT_IN_TEMPLATES[0],
            at,
            values: { title: "Two independent cards" },
          },
        },
      ],
    });
  const repeated = templates.getSnapshot().project.videoTracks.flatMap((t) => t.clips);
  assert(
    repeated.length === 2 && repeated[0].id !== repeated[1].id,
    "Template insertions need fresh IDs",
  );
  const frozen = encode(templates);
  let conflict = "";
  try {
    templates.apply({
      commands: [{ insertTemplate: { template: BUILT_IN_TEMPLATES[0], at: 0, mode: "place" } }],
    });
  } catch (cause) {
    conflict = cause.message;
  }
  assert(conflict && frozen === encode(templates), "Conflicting placement must be atomic");
  // Export a complete short card to exercise graphic composition in the encoder.
  const exportProject = decodeProjectFile({
    revision: 0,
    project: {
      settings: {
        width: 640,
        height: 360,
        alternateFormats: [{ id: "portrait", name: "Portrait", width: 270, height: 480 }],
      },
      videoTracks: [
        {
          id: "cards",
          kind: "video",
          clips: [
            {
              id: "exportcard",
              duration: 2,
              content: {
                graphic: { template: "sectionCard", props: { title: "Export", number: "01" } },
              },
            },
          ],
        },
      ],
    },
  }).project;
  const blob = await renderWebM(
    formatProject(exportProject, "portrait"),
    async () => null,
    new AbortController().signal,
    () => {},
  );
  const reader = await LocalMediaReader.open(new File([blob], "portrait.webm"), "video", 480);
  let exported;
  try {
    const frame = await reader.frame(1);
    exported = { width: frame.canvas.width, height: frame.canvas.height, bytes: blob.size };
    ctx.drawImage(frame.canvas, 0, 0, 270, 480);
    let white = 0;
    const data = ctx.getImageData(0, 0, 270, 480).data;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 220 && data[i + 1] > 220 && data[i + 2] > 220) white++;
    exported.white = white;
    assert(
      exported.width === 270 && exported.height === 480 && white > 40,
      "Portrait export must keep dimensions and title pixels",
    );
    images.exported = canvas.toDataURL();
  } finally {
    reader.close();
  }
  return {
    fonts: [...document.fonts]
      .filter((f) => f.family.includes("SideCut Card"))
      .map((f) => [f.family, f.status]),
    samples,
    inserted: { start: clip.start.seconds, duration: clip.duration.seconds, marker: movedMarker },
    hiddenPixel,
    saved: true,
    templates: repeated.map((v) => ({ id: v.id, start: v.start.seconds, link: v.linkGroup })),
    conflict,
    exported,
    images,
    initialBytes: initial.length,
  };
}
