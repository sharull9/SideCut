// Synthetic native-browser checks for phases 073–078. Run through Vite's /@fs/ import.
import { decodeProjectFile, encodeProjectFile } from "../../packages/contracts/src/project.ts";
import { mixTimelineAudio } from "../../packages/platform-browser/src/audio.ts";
import { renderWebM } from "../../packages/platform-browser/src/export.ts";
import { LocalMediaReader } from "../../packages/platform-browser/src/preview.ts";
import {
  measureSource,
  audioIdentity,
} from "../../packages/platform-browser/src/audio-analysis.ts";
import { LoudnessMeter } from "../../packages/core/src/loudness.ts";
import { BrowserProjectStore } from "../../packages/platform-browser/src/storage.ts";
const rate = 48000;
const assert = (value, message) => {
  if (!value) throw new Error(message);
};
export function soundFile(amplitude = 0.03) {
  const frames = rate * 3,
    bytes = new ArrayBuffer(44 + frames * 2),
    view = new DataView(bytes);
  const ascii = (at, text) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + frames * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++)
    view.setInt16(
      44 + i * 2,
      Math.round(amplitude * 32767 * Math.sin((2 * Math.PI * 400 * i) / rate)),
      true,
    );
  return new File([bytes], "sound-073.wav", { type: "audio/wav", lastModified: 1 });
}
export function soundProject() {
  return decodeProjectFile({
    revision: 0,
    project: {
      id: "sound_phases_073_078",
      name: "Sound processing verification",
      settings: {
        width: 64,
        height: 64,
        frameRate: { numerator: 10, denominator: 1 },
        loudnessTarget: -14,
        truePeakCeiling: -1,
      },
      media: [{ id: "tone", path: "sound-073.wav", kind: "audio", role: "camera", duration: 3 }],
      videoTracks: [
        {
          id: "picture",
          kind: "video",
          clips: [
            {
              id: "solid",
              duration: 2,
              content: { solid: { color: { r: 0.1, g: 0.25, b: 0.2, a: 1 } } },
            },
          ],
        },
      ],
      audioTracks: [
        {
          id: "voice",
          name: "Voice",
          kind: "audio",
          rippleMode: "cut",
          clips: [
            {
              id: "tone-clip",
              name: "Synthetic voice",
              duration: 2,
              sourceStart: 0.5,
              content: { media: { mediaID: "tone" } },
              audio: {
                gainDB: -3,
                normalizeTo: -20,
                fadeIn: 0.1,
                fadeOut: 0.2,
                effects: [
                  { id: "pitch", type: "pitchShift", enabled: true, params: { semitones: 12 } },
                  {
                    id: "comp",
                    type: "compressor",
                    enabled: true,
                    params: { threshold: -14, ratio: 3 },
                  },
                  { id: "limit", type: "limiter", enabled: true, params: { ceiling: -1 } },
                ],
              },
            },
          ],
        },
      ],
    },
  });
}
const frequency = (values) => {
  let crossings = 0;
  for (let i = rate / 2; i < rate * 1.5; i++) if (values[i] <= 0 && values[i + 1] > 0) crossings++;
  return crossings;
};
export async function verifySoundProcessing({ saveFixture = false } = {}) {
  const file = soundFile(),
    project = soundProject(),
    signal = new AbortController().signal;
  const resource = { file, state: "available", detail: "Synthetic mono 400 Hz tone" };
  const reader = await LocalMediaReader.open(file, "audio");
  let source, preview, mastered;
  try {
    source = await measureSource(file, reader, signal);
    assert(
      Math.abs(source.truePeakDBTP - 20 * Math.log10(0.03)) < 0.15,
      "Source true peak calibration",
    );
    const collect = async (master) => {
      const values = [],
        meter = new LoudnessMeter(rate, 2);
      for await (const block of mixTimelineAudio(
        project.project,
        async () => reader,
        signal,
        rate,
        4096,
        2,
        {
          master,
          measure: async () => source,
        },
      )) {
        values.push(...block.data.subarray(0, block.frames));
        meter.process([block.data.subarray(0, block.frames), block.data.subarray(block.frames)]);
      }
      return {
        ...meter.result(),
        frequency: frequency(values),
        firstSample: values[0],
        lastSample: values.at(-1),
      };
    };
    preview = await collect(false);
    mastered = await collect(true);
    assert(Math.abs(preview.frequency - 800) <= 4, `Preview pitch ${preview.frequency}`);
    assert(preview.firstSample === 0 && Math.abs(preview.lastSample) < 0.0001, "Fade endpoints");
    assert(
      Math.abs(mastered.integratedLUFS + 14) < 0.2,
      `Master loudness ${mastered.integratedLUFS}`,
    );
    assert(mastered.truePeakDBTP <= -0.95, "Master true peak ceiling");
  } finally {
    reader.close();
  }
  const blob = await renderWebM(
    project.project,
    async () => resource,
    signal,
    () => {},
  );
  const encoded = await LocalMediaReader.open(
    new File([blob], "sound.webm", { type: "video/webm" }),
    "video",
  );
  const meter = new LoudnessMeter(rate, 2),
    decoded = new Float32Array(rate * 2);
  try {
    for await (const item of encoded.audio(0, 2)) {
      const b = item.buffer;
      const from = Math.max(0, Math.ceil(-item.timestamp * rate)),
        to = Math.min(b.length, Math.ceil((2 - item.timestamp) * rate));
      if (to <= from) continue;
      const channels = [
        b.getChannelData(0).subarray(from, to),
        b.getChannelData(Math.min(1, b.numberOfChannels - 1)).subarray(from, to),
      ];
      meter.process(channels);
      const start = Math.max(0, Math.round(item.timestamp * rate) + from);
      decoded.set(
        channels[0].subarray(0, Math.min(channels[0].length, decoded.length - start)),
        start,
      );
    }
  } finally {
    encoded.close();
  }
  const result = {
    source,
    preview,
    mastered,
    encoded: { ...meter.result(), frequency: frequency(decoded), bytes: blob.size },
  };
  assert(
    Math.abs(result.encoded.integratedLUFS + 14) < 0.5,
    `Encoded loudness ${result.encoded.integratedLUFS}`,
  );
  assert(
    Math.abs(result.encoded.frequency - 800) <= 5,
    `Encoded pitch ${result.encoded.frequency}`,
  );
  if (saveFixture) {
    const store = await BrowserProjectStore.open();
    try {
      assert(
        !(await store.load(project.project.id)),
        "Refusing to replace an existing sound verification project",
      );
      await store.importProject(project);
      await store.putResource(project.project.id, "tone", resource);
    } finally {
      store.close();
    }
  }
  window.soundProjectJSON = encodeProjectFile(project);
  return result;
}
export async function verifyPersistentAnalysis() {
  let decoded = false;
  const measured = await measureSource(
    soundFile(),
    {
      audio: () => {
        decoded = true;
        throw new Error("Cached source was decoded again");
      },
    },
    new AbortController().signal,
  );
  assert(!decoded, "Analysis did not survive reload");
  assert(
    (await audioIdentity(soundFile())) !== (await audioIdentity(soundFile(0.04))),
    "Changed bytes did not invalidate identity",
  );
  return measured;
}
export async function verifyHotExport() {
  const original = soundProject(),
    clip = original.project.audioTracks[0].clips[0];
  const project = {
    ...original.project,
    settings: { ...original.project.settings, loudnessTarget: -6, truePeakCeiling: -6 },
    audioTracks: [
      { ...original.project.audioTracks[0], clips: [{ ...clip, audio: { gainDB: 6 } }] },
    ],
  };
  const signal = new AbortController().signal;
  const blob = await renderWebM(
    project,
    async () => ({ file: soundFile(0.9), state: "available", detail: "Hot calibration tone" }),
    signal,
    () => {},
  );
  const reader = await LocalMediaReader.open(
    new File([blob], "hot.webm", { type: "video/webm" }),
    "video",
  );
  const meter = new LoudnessMeter(rate, 2);
  try {
    for await (const item of reader.audio(0, 2)) {
      meter.process([item.buffer.getChannelData(0), item.buffer.getChannelData(1)]);
    }
  } finally {
    reader.close();
  }
  const result = meter.result();
  assert(
    result.truePeakDBTP <= -5.5,
    `Encoded hot signal exceeded ceiling tolerance: ${result.truePeakDBTP}`,
  );
  return { ...result, bytes: blob.size };
}
