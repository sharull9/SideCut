// Phases 091-096 runtime probes. Import through Vite's /@fs/<repo>/tests/browser/speech-titles.js.
import { decodeProjectFile, encodeProjectFile } from "../../packages/contracts/src/project.ts";
import { ProjectCoordinator } from "../../packages/core/src/coordinator.ts";
import { projectDuration } from "../../packages/core/src/render-plan.ts";
import { placeWords } from "../../packages/core/src/transcript.ts";
import {
  alignTranscript,
  findPauses,
  planCaptions,
  planTighten,
  searchSpeech,
  speechMap,
} from "../../packages/core/src/speech.ts";
import { missingFonts } from "../../packages/core/src/text.ts";
import { sourceSamples } from "../../packages/platform-browser/src/source-analysis.ts";
import { cachedTranscript } from "../../packages/platform-browser/src/transcription.ts";
import { probeLocalFile } from "../../packages/platform-browser/src/media.ts";
import { paintPicture } from "../../packages/platform-browser/src/picture.ts";
import { renderWebM } from "../../packages/platform-browser/src/export.ts";
import { LocalMediaReader } from "../../packages/platform-browser/src/preview.ts";
import { ensureFont, fontAvailable } from "../../packages/platform-browser/src/text.ts";

const ROOT = "/@fs/C:/sharull/coding/personal/side-cut";
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const signal = () => new AbortController().signal;
const nothing = () => {};
const round = (v) => Number(v.toFixed(3));

async function speech() {
  const file = new File(
    [await (await fetch(`${ROOT}/tests/fixtures/audio/speech.wav`)).arrayBuffer()],
    "speech.wav",
    { type: "audio/wav" },
  );
  const { item: raw } = await probeLocalFile(file);
  const item = { ...raw, id: "speech" };
  const parsed = decodeProjectFile({ revision: 0, project: { media: [item] } }).project.media[0];
  const samples = await sourceSamples(file, parsed, signal(), nothing);
  // Prefer this device's cached Whisper output; otherwise the recorded phase 089 output.
  let transcript = await cachedTranscript(file),
    origin = "local cache";
  if (!transcript) {
    const recorded = await (
      await fetch(`${ROOT}/docs/verification/phases-085-090-speech.json`)
    ).json();
    transcript = recorded.transcript;
    origin = "recorded phase 089 Whisper output";
  }
  return { file, item, samples, transcript, origin };
}

// Source 2.3-2.6 s is cut out, through "on"/"the"; a B-roll title track follows ripples.
function project(item, extra = {}) {
  const clip = (id, start, sourceStart, duration, link) => ({
    id,
    start,
    sourceStart,
    duration,
    linkGroup: link,
    content: { media: { mediaID: "speech" } },
  });
  return decodeProjectFile({
    revision: 0,
    project: {
      settings: { width: 640, height: 360, frameRate: { numerator: 30, denominator: 1 } },
      media: [item],
      videoTracks: [
        {
          id: "picture",
          kind: "video",
          clips: [
            {
              id: "bg",
              duration: 7.7,
              content: { solid: { color: { r: 0, g: 0, b: 0, a: 1 } } },
              linkGroup: "a",
            },
          ],
        },
      ],
      audioTracks: [
        {
          id: "voice",
          kind: "audio",
          name: "Voice",
          clips: [clip("v0", 0, 0, 2.3, "a"), clip("v1", 2.3, 2.6, 5.4, "b")],
        },
      ],
      ...extra,
    },
  });
}

export async function verifySpeechEdits() {
  const { item, samples, transcript, origin } = await speech();
  const aligned = alignTranscript(transcript, samples.peaks, samples.peaksPerSecond);
  const file = project(item);
  const lookup = () => aligned;
  const searches = Object.fromEntries(
    ["birch canoes", "THE SMOOTH planks", "on the", "glue, the sheet!"].map((phrase) => {
      const r = searchSpeech(file, phrase, lookup);
      return [
        phrase,
        {
          hits: r.hits.map((h) => ({
            start: round(h.start),
            end: round(h.end),
            partial: h.partial,
            clipIDs: h.clipIDs,
          })),
          unused: r.unused.map((u) => ({ start: round(u.mediaStart), end: round(u.mediaEnd) })),
        },
      ];
    }),
  );
  const rawPauses = findPauses(
    speechMap(file.project, () => transcript),
    0.2,
  );
  const alignedPauses = findPauses(speechMap(file.project, lookup), 0.2);
  // A second, untranscribed source on the speech track: its time is unknown, not a pause.
  const withMissing = project(
    { ...item },
    {
      media: [item, { ...item, id: "other", path: "other.wav" }],
      audioTracks: [
        {
          id: "voice",
          kind: "audio",
          clips: [
            {
              id: "v0",
              duration: 4,
              content: { media: { mediaID: "speech" } },
            },
            {
              id: "o",
              start: 4,
              sourceStart: 4,
              duration: 3,
              content: { media: { mediaID: "other" } },
            },
          ],
        },
      ],
    },
  );
  const missingMap = speechMap(withMissing.project, (m) =>
    m.id === "speech" ? aligned : undefined,
  );
  const missingPauses = findPauses(missingMap, 0.2);
  assert(
    missingPauses.every((p) => p.end <= 4),
    "Pauses never extend into untranscribed speech",
  );

  const plan = planTighten(file, { min: 0.3, keep: 0.15 }, lookup);
  const coordinator = new ProjectCoordinator(file);
  coordinator.apply({ label: plan.label, commands: plan.commands, expectedRevision: 0 });
  const after = coordinator.getSnapshot().project;
  const actual = projectDuration(after).seconds;
  assert(Math.abs(actual - plan.durationAfter) < 1e-6, "Preview duration matches the applied cut");
  const audioEnds = after.audioTracks[0].clips.at(-1);
  const pictureEnds = after.videoTracks[0].clips.at(-1);
  assert(
    Math.abs(
      audioEnds.start.seconds +
        audioEnds.duration.seconds -
        (pictureEnds.start.seconds + pictureEnds.duration.seconds),
    ) < 1e-6,
    "Picture and voice stay in sync",
  );
  coordinator.undo();
  assert(
    encodeProjectFile({ revision: 0, project: coordinator.getSnapshot().project }) ===
      encodeProjectFile({ revision: 0, project: file.project }),
    "One undo restores every track",
  );
  const captions = planCaptions(file, {}, lookup, () => "trk_captions");
  const lane = placeWords(aligned, file.project.audioTracks[0].clips).map((w) => w.text);
  assert(
    captions.captions.flatMap((c) => c.text.split(" ")).join(" ") === lane.join(" "),
    "Captions include exactly the transcript lane words",
  );
  const captioned = new ProjectCoordinator(file);
  captioned.apply({ label: captions.label, commands: captions.commands });
  captioned.undo();
  assert(
    captioned.getSnapshot().project.videoTracks.length === 1,
    "One undo removes the caption batch",
  );
  return {
    transcriptOrigin: origin,
    raw: transcript.words.map((w) => [w.text, w.start, w.end]),
    aligned: aligned.words.map((w) => [w.text, round(w.start), round(w.end)]),
    lane,
    searches,
    pauses: {
      raw: rawPauses.map((p) => [round(p.start), round(p.end)]),
      aligned: alignedPauses.map((p) => [round(p.start), round(p.end), p.before.split(" ").at(-1)]),
      withMissingTranscript: missingPauses.map((p) => [round(p.start), round(p.end)]),
      missing: missingMap.missing,
    },
    tighten: {
      label: plan.label,
      cuts: plan.cuts.map((c) => [round(c.cut.start), round(c.cut.end)]),
      removed: round(plan.removed),
      before: round(plan.durationBefore),
      preview: round(plan.durationAfter),
      applied: round(actual),
    },
    captions: captions.captions.map((c) => [round(c.start), round(c.end), c.text]),
  };
}

function titleProject(extraClips = [], settings = {}) {
  return decodeProjectFile({
    revision: 0,
    project: {
      settings: {
        width: 1280,
        height: 720,
        frameRate: { numerator: 30, denominator: 1 },
        ...settings,
      },
      videoTracks: [
        {
          id: "bg",
          kind: "video",
          clips: [
            { id: "bg", duration: 4, content: { solid: { color: { r: 0, g: 0, b: 1, a: 1 } } } },
          ],
        },
        {
          id: "titles",
          kind: "video",
          clips: [
            {
              id: "label",
              start: 0,
              duration: 2,
              content: { text: { text: "Label", preset: "label" } },
            },
            ...extraClips,
          ],
        },
      ],
    },
  }).project;
}

/** Bounding box and peak brightness of non-blue pixels: where the title drew. */
function inked(ctx) {
  const { width, height } = ctx.canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1,
    peak = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        ink = Math.max(data[i], data[i + 1]);
      if (ink > 24) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      peak = Math.max(peak, ink);
    }
  return maxX < 0
    ? { peak }
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, peak };
}

export async function verifyTitles() {
  await ensureFont("Tilt Warp", 400);
  const frames = {};
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const reader = async () => {
    throw new Error("No media in title fixtures");
  };
  const caption = {
    id: "caption",
    start: 2,
    duration: 2,
    content: {
      text: {
        text: "one two three",
        preset: "caption",
        words: [
          { text: "one", start: 0, end: 0.4 },
          { text: "two", start: 0.5, end: 0.9 },
          { text: "three", start: 1, end: 1.6 },
        ],
      },
    },
  };
  const header = {
    id: "header",
    start: 2,
    duration: 2,
    content: { text: { text: "Tip 1\nCursor docs", preset: "sectionHeader" } },
    video: { transform: { position: { x: 0.5, y: 0.2 } } },
  };
  const titles = titleProject([caption]);
  const images = {};
  for (const t of [0, 0.0625, 0.125, 0.25, 1, 1.75, 1.99]) {
    await paintPicture(ctx, titles, t, reader);
    frames[`label@${t}`] = inked(ctx);
  }
  images.label = canvas.toDataURL("image/png");
  for (const t of [2.2, 2.6, 3.2]) {
    await paintPicture(ctx, titles, t, reader);
    const data = ctx.getImageData(0, 0, 1280, 720).data;
    // Highlight pixels: yellow (red and green high, blue low).
    let highlighted = 0,
      minX = 1280,
      maxX = -1;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 200 && data[i + 1] > 170 && data[i + 2] < 90) {
        highlighted++;
        const x = (i / 4) % 1280;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    frames[`caption@${t}`] = { ...inked(ctx), highlighted, highlightX: [minX, maxX] };
    images[`caption@${t}`] = canvas.toDataURL("image/png");
  }
  const headerProject = titleProject([header]);
  for (const t of [2, 2.1, 2.45, 3]) {
    await paintPicture(ctx, headerProject, t, reader);
    frames[`header@${t}`] = inked(ctx);
  }
  images.header = canvas.toDataURL("image/png");
  const missingProject = titleProject([
    {
      id: "odd",
      start: 2,
      duration: 1,
      content: { text: { text: "x", style: { font: "Nonexistent Sans 91" } } },
    },
    { id: "cap", start: 3, duration: 1, content: { text: { text: "y", preset: "caption" } } },
  ]);
  const missing = missingFonts(missingProject, fontAvailable, true);
  assert(frames["label@0"].x === undefined, "Fade-in starts invisible");
  assert(frames["label@0.25"].peak > 240, "Fade-in reaches full opacity at its boundary");
  assert(frames["caption@2.2"].highlighted > 0, "Spoken caption word is highlighted");
  assert(
    frames["caption@2.2"].highlightX[1] < frames["caption@2.6"].highlightX[0],
    "Highlight moves to the next word",
  );
  const exported = await renderWebM(titles, async () => null, signal(), nothing);
  const decoded = await LocalMediaReader.open(new File([exported], "titles.webm"), "video", 1280);
  let exportedInk;
  try {
    const frame = await decoded.frame(1);
    ctx.drawImage(frame.canvas, 0, 0, 1280, 720);
    exportedInk = inked(ctx);
  } finally {
    decoded.close();
  }
  return {
    tiltWarp: fontAvailable("Tilt Warp"),
    missing: missing.map((m) => m.name),
    frames,
    export: { bytes: exported.size, ink: exportedInk },
    images,
  };
}
