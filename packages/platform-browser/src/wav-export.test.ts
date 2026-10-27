import { expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import { renderWAV } from "./wav-export";

it("writes a complete stereo PCM WAV for a fractional export range", async () => {
  const project = decodeProjectFile({ revision: 0, project: {} }).project;
  const progress: number[] = [];
  const blob = await renderWAV(
    project,
    async () => null,
    new AbortController().signal,
    (value) => progress.push(value),
    0.1,
    0.35,
  );
  const buffer = await blob.arrayBuffer(),
    view = new DataView(buffer);
  expect(blob.type).toBe("audio/wav");
  expect(new TextDecoder().decode(buffer.slice(0, 4))).toBe("RIFF");
  expect(new TextDecoder().decode(buffer.slice(8, 12))).toBe("WAVE");
  expect(view.getUint16(22, true)).toBe(2);
  expect(view.getUint32(24, true)).toBe(48000);
  expect(view.getUint32(40, true)).toBe(12000 * 4);
  expect(buffer.byteLength).toBe(44 + 12000 * 4);
  expect(new Uint8Array(buffer, 44).every((value) => value === 0)).toBe(true);
  expect(progress.at(-1)).toBe(1);
});

it("rejects cancellation and invalid WAV ranges", async () => {
  const project = decodeProjectFile({ revision: 0, project: {} }).project;
  const controller = new AbortController();
  controller.abort();
  await expect(
    renderWAV(
      project,
      async () => null,
      controller.signal,
      () => {},
      0,
      1,
    ),
  ).rejects.toThrow();
  for (const end of [0, NaN, Infinity, 30000])
    await expect(
      renderWAV(
        project,
        async () => null,
        new AbortController().signal,
        () => {},
        0,
        end,
      ),
    ).rejects.toThrow("format limit");
});
