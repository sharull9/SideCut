import {
  decodeProjectFile,
  encodeProjectFile,
  transitionTypes,
} from "../../packages/contracts/src/project.ts";
import { paintPicture } from "../../packages/platform-browser/src/picture.ts";
import { renderWebM } from "../../packages/platform-browser/src/export.ts";
import { LocalMediaReader } from "../../packages/platform-browser/src/preview.ts";
import { mixTimelineAudio } from "../../packages/platform-browser/src/audio.ts";
import { BrowserProjectStore } from "../../packages/platform-browser/src/storage.ts";
import { SourcePreview } from "../../apps/web/src/modules/workspace/source-preview.ts";
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const near = (a, b, tolerance = 2) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const surface = () => {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  return c;
};
const sample = (canvas, x = 32, y = 32) => [
  ...canvas.getContext("2d").getImageData(x, y, 1, 1).data,
];
const solid = (id, start, duration, color, extra = {}) => ({
  id,
  name: id,
  start,
  duration,
  content: { solid: { color } },
  ...extra,
});
const red = { r: 1, g: 0, b: 0, a: 1 },
  blue = { r: 0, g: 0, b: 1, a: 1 },
  green = { r: 0, g: 1, b: 0, a: 1 };
const project = (tracks, audio = [], media = []) =>
  decodeProjectFile({
    revision: 0,
    project: {
      id: "transitions_067",
      name: "Transitions and adjustment",
      settings: { width: 64, height: 64, frameRate: { numerator: 10, denominator: 1 } },
      media,
      videoTracks: tracks,
      audioTracks: audio,
    },
  });
const track = (id, clips, transitions = [], extra = {}) => ({
  id,
  name: id,
  kind: "video",
  clips,
  transitions,
  ...extra,
});
const missing = async () => {
  throw new Error("Solid/adjustment attempted to load media");
};
async function paint(p, time) {
  const canvas = surface();
  await paintPicture(canvas.getContext("2d"), p, time, missing);
  return canvas;
}
export async function verifyTransitions({ saveFixture = false } = {}) {
  const results = [];
  for (const type of transitionTypes)
    for (const direction of ["left", "right", "up", "down"]) {
      const file = project([
        track(
          "base",
          [solid("left", 0, 2, red), solid("right", 2, 2, blue)],
          [{ id: "tr", type, direction, duration: 2, fromClipID: "left", toClipID: "right" }],
        ),
      ]);
      const beginning = sample(await paint(file.project, 1)),
        middle = sample(await paint(file.project, 2)),
        ending = sample(await paint(file.project, 3));
      assert(near(beginning, [255, 0, 0, 255]), `${type}/${direction} start ${beginning}`);
      assert(near(ending, [0, 0, 255, 255]), `${type}/${direction} end ${ending}`);
      if (type === "dissolve" || type === "zoom")
        assert(near(middle, [128, 0, 128, 255]), `${type} midpoint ${middle}`);
      if (type.startsWith("fade")) assert(near(middle, [0, 0, 0, 255]), `${type} black midpoint`);
      if (direction === "left") results.push({ type, beginning, middle, ending });
    }
  const overlay = project([
    track("base", [solid("base", 0, 4, green)]),
    track(
      "overlay",
      [solid("overlay", 1, 2, blue)],
      [
        { id: "enter", type: "push", direction: "left", duration: 0.5, toClipID: "overlay" },
        { id: "exit", type: "push", direction: "left", duration: 0.5, fromClipID: "overlay" },
      ],
    ),
  ]);
  assert(
    near(sample(await paint(overlay.project, 1.01)), [0, 255, 0, 255]),
    "Lower track not visible during entry",
  );
  assert(near(sample(await paint(overlay.project, 2)), [0, 0, 255, 255]), "Overlay missing");
  assert(
    near(sample(await paint(overlay.project, 2.99)), [0, 255, 0, 255]),
    "Lower track not visible during exit",
  );
  for (const type of ["slide", "cutSlide", "wipe", "zoom"])
    for (const direction of ["left", "right", "up", "down"]) {
      const value = project([
        track("base", [solid("base", 0, 4, green)]),
        track(
          "overlay",
          [solid("overlay", 1, 2, blue)],
          [
            { id: "enter", type, direction, duration: 0.5, toClipID: "overlay" },
            { id: "exit", type, direction, duration: 0.5, fromClipID: "overlay" },
          ],
        ),
      ]);
      assert(
        near(sample(await paint(value.project, 1)), [0, 255, 0, 255]),
        `${type}/${direction} overlay entry`,
      );
      assert(
        near(sample(await paint(value.project, 2)), [0, 0, 255, 255]),
        `${type}/${direction} overlay middle`,
      );
      const ending = sample(await paint(value.project, 2.99999));
      assert(
        near(ending, type === "slide" ? [0, 0, 255, 255] : [0, 255, 0, 255], 3),
        `${type}/${direction} overlay exit ${ending}`,
      );
    }
  const adjustment = project([
    track("base", [solid("base", 0, 2, { r: 0.25, g: 0, b: 0, a: 1 })]),
    track("grade", [
      {
        id: "grade",
        name: "Adjustment",
        start: 0,
        duration: 2,
        content: { adjustment: {} },
        video: {
          opacity: 0.5,
          effects: [{ id: "color", type: "colorAdjust", params: { exposure: 1 } }],
        },
      },
    ]),
    track("above", [solid("top", 0, 2, green, { video: { transform: { scale: 0.5 } } })]),
  ]);
  const graded = await paint(adjustment.project, 1),
    under = sample(graded, 4, 4),
    above = sample(graded);
  assert(near(under, [76, 0, 0, 255]), `Adjustment opacity/group ${under}`);
  assert(near(above, [0, 255, 0, 255]), "Adjustment affected higher track");
  const adjustmentBlob = await renderWebM(
    adjustment.project,
    missing,
    new AbortController().signal,
    () => {},
  );
  const adjustmentReader = await LocalMediaReader.open(
    new File([adjustmentBlob], "adjustment.webm"),
    "video",
  );
  let adjustmentEncoded;
  try {
    const frame = await adjustmentReader.frame(1),
      canvas = surface();
    canvas.getContext("2d").drawImage(frame.canvas, 0, 0);
    adjustmentEncoded = { under: sample(canvas, 4, 4), above: sample(canvas) };
    assert(
      near(adjustmentEncoded.under, under, 12) && near(adjustmentEncoded.above, above, 12),
      "Adjustment export differs from preview",
    );
  } finally {
    adjustmentReader.close();
  }
  const exportFile = project([
    track(
      "base",
      [solid("left", 0, 1, red), solid("right", 1, 1, blue)],
      [{ id: "tr", type: "dissolve", duration: 1, fromClipID: "left", toClipID: "right" }],
    ),
  ]);
  const blob = await renderWebM(
      exportFile.project,
      missing,
      new AbortController().signal,
      () => {},
    ),
    reader = await LocalMediaReader.open(
      new File([blob], "dissolve.webm", { type: "video/webm" }),
      "video",
    );
  const encoded = [];
  try {
    for (const time of [0.5, 1, 1.5]) {
      const frame = await reader.frame(time),
        canvas = surface();
      canvas.getContext("2d").drawImage(frame.canvas, 0, 0, 64, 64);
      const value = sample(canvas),
        expected = sample(await paint(exportFile.project, time));
      assert(near(value, expected, 12), `Transition export mismatch ${time}: ${value}/${expected}`);
      encoded.push({ time, value, expected });
    }
  } finally {
    reader.close();
  }
  if (saveFixture) {
    const store = await BrowserProjectStore.open();
    try {
      await store.importProject(exportFile);
    } finally {
      store.close();
    }
  }
  window.transitionProjectJSON = encodeProjectFile(exportFile);
  return {
    types: results,
    adjustment: { under, above, encoded: adjustmentEncoded },
    encoded,
    bytes: blob.size,
  };
}
function pulseFile() {
  const rate = 48000,
    length = rate,
    buffer = new ArrayBuffer(44 + length * 2),
    view = new DataView(buffer),
    ascii = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const t = i / rate,
      active = (t >= 0.2 && t < 0.25) || (t >= 0.6 && t < 0.65);
    view.setInt16(
      44 + i * 2,
      active ? Math.round(0.1 * Math.sin(2 * Math.PI * 400 * t) * 32767) : 0,
      true,
    );
  }
  return new File([buffer], "pulses.wav", { type: "audio/wav" });
}
export async function verifyTimelineAudio() {
  const file = pulseFile(),
    resource = { file, state: "available", detail: "Synthetic two-pulse PCM" },
    reference = { media: { mediaID: "pulse" } },
    p = project(
      [],
      [
        track(
          "one",
          [{ id: "one", start: 0.1, duration: 0.5, sourceStart: 0.2, content: reference }],
          [],
          { kind: "audio" },
        ),
        track(
          "two",
          [{ id: "two", start: 0.1, duration: 0.3, sourceStart: 0.6, content: reference }],
          [],
          { kind: "audio" },
        ),
        track(
          "muted",
          [{ id: "ignored", start: 0, duration: 0.6, sourceStart: 0, content: reference }],
          [],
          { kind: "audio", muted: true, solo: true },
        ),
      ],
      [{ id: "pulse", path: "pulses.wav", kind: "audio", duration: 1 }],
    );
  const reader = await LocalMediaReader.open(file, "audio"),
    raw = [];
  try {
    for await (const block of mixTimelineAudio(
      p.project,
      async () => reader,
      new AbortController().signal,
    ))
      raw.push(...block.data.subarray(0, block.frames));
  } finally {
    reader.close();
  }
  const rms = (from, to) => {
    const values = raw.slice(Math.round(from * 48000), Math.round(to * 48000));
    return Math.sqrt(values.reduce((a, b) => a + b * b, 0) / values.length);
  };
  assert(rms(0.11, 0.14) > 0.13 && rms(0.11, 0.14) < 0.15, "Overlapping pulses did not sum");
  assert(rms(0.02, 0.07) === 0 && rms(0.3, 0.38) === 0, "Mixer filled silence gaps");
  const blob = await renderWebM(
      p.project,
      async () => resource,
      new AbortController().signal,
      () => {},
    ),
    encoded = await LocalMediaReader.open(
      new File([blob], "pulse-export.webm", { type: "video/webm" }),
      "video",
    );
  const decoded = [];
  try {
    for (const [from, to] of [
      [0.02, 0.07],
      [0.11, 0.14],
      [0.3, 0.38],
      [0.51, 0.54],
    ]) {
      let power = 0,
        count = 0;
      const stream = encoded.audio(from, to);
      try {
        for await (const item of stream) {
          const data = item.buffer.getChannelData(0);
          for (let i = 0; i < data.length; i++) {
            const t = item.timestamp + i / item.buffer.sampleRate;
            if (t >= from && t < to) {
              power += data[i] * data[i];
              count++;
            }
          }
        }
      } finally {
        await stream.return();
      }
      decoded.push({ from, to, rms: count ? Math.sqrt(power / count) : 0 });
    }
  } finally {
    encoded.close();
  }
  assert(decoded[0].rms < 0.003 && decoded[2].rms < 0.003, "Encoded gaps are not silent");
  assert(Math.abs(decoded[1].rms - rms(0.11, 0.14)) < 0.02, "Encoded mixed pulse level");
  const canvas = surface(),
    calls = [],
    errors = [],
    timestamps = new WeakMap(),
    originalAudio = LocalMediaReader.prototype.audio,
    original = AudioBufferSourceNode.prototype.start;
  LocalMediaReader.prototype.audio = async function* (...args) {
    for await (const item of originalAudio.apply(this, args)) {
      timestamps.set(item.buffer, item.timestamp);
      yield item;
    }
  };
  AudioBufferSourceNode.prototype.start = function (...args) {
    calls.push([...args, timestamps.get(this.buffer)]);
    return original.apply(this, args);
  };
  const session = { getSnapshot: () => ({ project: p.project }), resource: async () => resource };
  const engine = new SourcePreview(
    canvas,
    session,
    () => {},
    () => {},
    (error) => {
      if (error) errors.push(error);
    },
  );
  try {
    await engine.play(0);
    await new Promise((r) => setTimeout(r, 200));
    engine.pause();
    const first = calls.slice();
    calls.length = 0;
    await engine.play(0.12);
    await new Promise((r) => setTimeout(r, 150));
    engine.pause();
    assert(first.length >= 2 && calls.length >= 2, "Playback did not schedule both tracks");
    assert(
      Math.abs(first[0][0] - first[1][0]) < 1 / 48000,
      "Playback tracks have different clocks",
    );
    assert(
      calls.some((c) => Math.abs(c[1] + c[3] - 0.22) < 0.002) &&
        calls.some((c) => Math.abs(c[1] + c[3] - 0.62) < 0.002),
      "Seek did not map to source offset",
    );
    assert(!errors.length, errors.join(";"));
    return {
      rawRMS: rms(0.11, 0.14),
      decoded,
      bytes: blob.size,
      initialCalls: first,
      seekCalls: calls.slice(),
    };
  } finally {
    engine.close();
    AudioBufferSourceNode.prototype.start = original;
    LocalMediaReader.prototype.audio = originalAudio;
  }
}
