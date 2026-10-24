import type { BrowserProjectSession } from "./browser-session";
import { LocalMediaReader } from "@sidecut/platform-browser/preview";
import { paintPicture } from "@sidecut/platform-browser/picture";
import { createLUTLoader } from "@sidecut/platform-browser/lut";
import { formatProject } from "@sidecut/core/formats";
import { projectDuration, previewIssue, framePlan, exportPlan } from "@sidecut/core/render-plan";
import { cutoutOf } from "@sidecut/core/cutout";
import { QueryError, queryTracks } from "@sidecut/core/project-queries";
import { LoudnessMeter } from "@sidecut/core/loudness";
import { mixTimelineAudio } from "@sidecut/platform-browser/audio";
import { measureSource } from "@sidecut/platform-browser/audio-analysis";
import { fontAvailable } from "@sidecut/platform-browser/text";
import { resolveText, textContent } from "@sidecut/core/text";
import { cachedMatte } from "@sidecut/platform-browser/cutout";
import { normalizeGain } from "@sidecut/core/audio-processing";
import { speechTracks } from "@sidecut/core/speech";
import { inspectionTimes } from "@sidecut/core/service-requests";
const png = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed."))),
      "image/png",
    ),
  );
const base64 = async (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]!);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
export async function renderService(
  session: BrowserProjectSession,
  operation: string,
  request: Record<string, unknown>,
  signal: AbortSignal,
) {
  let project = formatProject(session.getSnapshot().project, (request.format as string) ?? null);
  const duration = projectDuration(project).seconds,
    readers = new Map<string, Promise<LocalMediaReader>>(),
    warnings = new Set<string>();
  const resource = (id: string) => session.resource(id);
  const reader = (id: string) => {
    let existing = readers.get(id);
    if (!existing) {
      existing = (async () => {
        const item = project.media.find((m) => m.id === id),
          local = await resource(id);
        if (!item || local?.state !== "available")
          throw new Error(`Source ${item?.path ?? id} is missing or unsupported.`);
        const opened = await LocalMediaReader.open(
          local.file,
          item.kind,
          Math.min(1920, project.settings.width),
        );
        return opened;
      })();
      readers.set(id, existing);
    }
    return existing;
  };
  const lut = createLUTLoader(resource);
  try {
    if (operation !== "loudness") {
      const tracks = [];
      for (const track of project.videoTracks) {
        const clips = [];
        for (const clip of track.clips) {
          let candidate = clip;
          const text = textContent(clip);
          if (text) {
            const family = resolveText(text).style.font;
            if (!fontAvailable(family))
              warnings.add(`Font "${family}" is missing; the renderer uses its fallback.`);
          }
          const cutout = cutoutOf(clip),
            id = (clip.content.media as { mediaID?: string } | undefined)?.mediaID;
          if (cutout?.enabled && id) {
            const local = await resource(id);
            if (local && !(await cachedMatte(local.file))) {
              warnings.add(`Missing matte for ${id}; background remains visible.`);
              candidate = {
                ...clip,
                video: { ...clip.video, cutout: { enabled: false } },
              };
            }
          }
          clips.push(candidate);
        }
        tracks.push({ ...track, clips });
      }
      project = { ...project, videoTracks: tracks };
    }
    if (["frame", "frames"].includes(operation)) {
      const times =
        operation === "frame" ? [Number(request.time)] : inspectionTimes(request, duration);
      if (
        !times.length ||
        times.length > 48 ||
        times.some((t) => !Number.isFinite(t) || t < 0 || t > duration)
      )
        throw new QueryError("badRequest", "Select 1-48 frame times inside the timeline.");
      const width = Number(
          operation === "frames"
            ? (request.width ?? 480)
            : (request.maxWidth ?? project.settings.width),
        ),
        height = Number(request.maxHeight ?? project.settings.height);
      if (
        width < 1 ||
        height < 1 ||
        width > 8192 ||
        height > 8192 ||
        (operation === "frames" && (width < 64 || width > 1920))
      )
        throw new QueryError("badRequest", "Invalid frame dimensions.");
      const scale =
          operation === "frames"
            ? width / project.settings.width
            : Math.min(1, width / project.settings.width, height / project.settings.height),
        w = Math.max(1, Math.round(project.settings.width * scale)),
        h = Math.max(1, Math.round(project.settings.height * scale));
      const columns =
          operation === "frame"
            ? 1
            : Math.max(
                1,
                Math.min(
                  times.length,
                  Math.ceil(Math.sqrt((((times.length * h) / w) * 16) / 9) - 0.001),
                ),
              ),
        rows = Math.ceil(times.length / columns),
        gap = operation === "frame" ? 0 : 8,
        label = operation === "frame" ? 0 : 28;
      const sheet = document.createElement("canvas");
      sheet.width = columns * w + (columns + 1) * gap;
      sheet.height = rows * (h + label) + (rows + 1) * gap;
      if (sheet.width * sheet.height > 32000000)
        throw new QueryError("badRequest", "Contact sheet exceeds 32 million pixels.");
      const ctx = sheet.getContext("2d")!;
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      const tile = document.createElement("canvas");
      tile.width = w;
      tile.height = h;
      const paint = tile.getContext("2d")!;
      for (const [index, time] of times.entries()) {
        signal.throwIfAborted();
        const issue = previewIssue(project, time);
        if (issue) throw new Error(issue);
        for (const layer of framePlan(project, time).layers) {
          if (
            layer.mediaID &&
            cutoutOf(layer.clip)?.enabled &&
            !session.analysis.getSnapshot()[layer.mediaID]?.matte
          )
            warnings.add(`Missing matte for ${layer.mediaID}; background remains visible.`);
        }
        await paintPicture(paint, project, time, reader, signal, lut);
        const x = gap + (index % columns) * (w + gap),
          y = gap + Math.floor(index / columns) * (h + label + gap);
        ctx.drawImage(tile, x, y);
        if (label) {
          ctx.fillStyle = "white";
          ctx.font = "14px sans-serif";
          ctx.fillText(`${time.toFixed(3)} s`, x + 8, y + h + 19);
        }
      }
      const blob = await png(sheet);
      return {
        ...(operation === "frame" ? { time: times[0] } : { times }),
        png: await base64(blob),
        bytes: blob.size,
        warnings: [...warnings],
        width: sheet.width,
        height: sheet.height,
      };
    }
    if (request.tracks) {
      const refs = request.tracks as string[],
        tracks = queryTracks(project);
      const selected = refs.map(
        (ref) =>
          tracks.find(
            (row) =>
              row.track.kind === "audio" &&
              [row.track.id, row.track.name, row.label, row.label.split(" ")[0]!].some(
                (value) => value.toLowerCase() === ref.toLowerCase(),
              ),
          )?.track.id,
      );
      if (selected.some((id) => !id))
        throw new QueryError("notFound", "An audio track was not found.");
      project = {
        ...project,
        audioTracks: project.audioTracks.map((t) => ({
          ...t,
          muted: !selected.includes(t.id),
          solo: false,
        })),
      };
    }
    if (operation === "loudness") {
      if (request.gains === true)
        throw new QueryError("notImplemented", "Per-track gain verification is not implemented.");
      const files: {
        mediaID: string;
        path: string;
        integratedLUFS: number;
        truePeakDBTP: number;
        loudnessRange: number;
        state: string;
      }[] = [];
      let curve: unknown, peaks: unknown;
      if (
        request.mediaID != null ||
        !["from", "to", "step", "tracks", "over"].some((key) => request[key] != null)
      ) {
        const items = request.mediaID
          ? project.media.filter((m) => m.id === request.mediaID)
          : project.media.filter((m) => m.hasAudio);
        if (request.mediaID && !items.length)
          throw new QueryError("notFound", "No matching media.");
        for (const item of items) {
          const local = await resource(item.id);
          if (!local) throw new Error(`Missing source ${item.path}.`);
          const measured = await measureSource(
            local.file,
            await reader(item.id),
            signal,
            () => {},
            item.duration?.seconds,
          );
          files.push({ mediaID: item.id, path: item.path, ...measured, state: "ready" });
        }
      } else {
        const start = Number(request.from ?? 0),
          end = Number(request.to ?? duration),
          step = Number(request.step ?? Math.max(0.1, (end - start) / 50));
        if (step <= 0 || end <= start || end > duration || Math.ceil((end - start) / step) > 1000)
          throw new QueryError("badRequest", "Invalid loudness window range or step.");
        if (end - start > 300)
          throw new QueryError("badRequest", "Loudness ranges are limited to five minutes.");
        const buffers = [
            new Float32Array(Math.ceil((end - start) * 48000)),
            new Float32Array(Math.ceil((end - start) * 48000)),
          ],
          meter = new LoudnessMeter(48000, 2);
        let offset = 0;
        for await (const block of mixTimelineAudio(project, reader, signal, 48000, 4096, end, {
          start,
          master: false,
          measure: async (id) =>
            measureSource((await resource(id))!.file, await reader(id), signal),
        })) {
          const channels = [
            block.data.subarray(0, block.frames),
            block.data.subarray(block.frames),
          ];
          meter.process(channels);
          for (let channel = 0; channel < 2; channel++)
            buffers[channel]!.set(channels[channel]!, offset);
          offset += block.frames;
        }
        const points = [];
        const atWindow = (at: number, span: number) => {
          const local = new LoudnessMeter(48000, 2),
            begin = Math.max(0, Math.floor((at - start - span / 2) * 48000)),
            stop = Math.min(offset, Math.ceil((at - start + span / 2) * 48000));
          const channels = buffers.map((b) => b.subarray(begin, stop));
          local.process(channels);
          let peak = 0;
          for (const values of channels)
            for (const value of values) peak = Math.max(peak, Math.abs(value));
          return { ...local.result(), peakDBFS: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
        };
        for (let at = start; at <= end + 1e-9; at += step) {
          signal.throwIfAborted();
          const moment = atWindow(at, 0.4),
            short = atWindow(at, 3);
          points.push({
            time: at,
            momentaryLUFS: moment.integratedLUFS,
            shortTermLUFS: short.integratedLUFS,
            peakDBFS: moment.peakDBFS,
          });
        }
        const measured = meter.result();
        curve = {
          start,
          end,
          step,
          points,
          integratedLUFS: measured.integratedLUFS,
          truePeakDBTP: measured.truePeakDBTP,
        };
        if (request.over != null) {
          const selected = points.filter((point) => point.peakDBFS > Number(request.over)),
            stretches: { start: number; end: number; peakDBFS: number; windows: number }[] = [];
          for (const point of selected) {
            const previous = stretches.at(-1),
              a = Math.max(start, point.time - 0.2),
              b = Math.min(end, point.time + 0.2);
            if (previous && a <= previous.end) {
              previous.end = b;
              previous.peakDBFS = Math.max(previous.peakDBFS, point.peakDBFS);
              previous.windows++;
            } else stretches.push({ start: a, end: b, peakDBFS: point.peakDBFS, windows: 1 });
          }
          peaks = { threshold: request.over, windows: selected.length, stretches };
        }
      }
      const speech = new Set(speechTracks(project).map((track) => track.id));
      const clips = queryTracks(project)
        .filter(({ track }) => track.kind === "audio")
        .flatMap(({ track, label }) =>
          track.clips.flatMap((clip) => {
            const id = (clip.content.media as { mediaID?: string } | undefined)?.mediaID;
            if (!id) return [];
            const measured = files.find((item) => item.mediaID === id),
              target = clip.audio?.normalizeTo,
              gain = Number(clip.audio?.gainDB ?? 0),
              normal =
                measured && typeof target === "number"
                  ? normalizeGain(target, measured.integratedLUFS)
                  : 0;
            return [
              {
                clipID: clip.id,
                mediaID: id,
                track: label,
                gainDB: gain,
                ...(target == null ? {} : { normalizeTo: target }),
                ...(measured
                  ? { normalizeGainDB: normal, peakDBTP: measured.truePeakDBTP + normal + gain }
                  : {}),
                speech: speech.has(track.id),
                muted: track.muted || clip.audio?.muted === true || !clip.enabled,
              },
            ];
          }),
        );
      return JSON.parse(
        JSON.stringify({
          target: project.settings.loudnessTarget,
          truePeakCeiling: project.settings.truePeakCeiling,
          speechLoudness: project.settings.speechLoudness,
          media: files,
          clips,
          ...(curve ? { curve } : {}),
          ...(request.tracks ? { tracks: request.tracks } : {}),
          ...(peaks ? { peaks } : {}),
        }),
      );
    }
    const start = Number(operation === "clip" ? request.start : (request.from ?? 0)),
      end = Number(operation === "clip" ? request.end : (request.to ?? duration));
    const preset = String(request.preset ?? (operation === "clip" ? "review" : "final"));
    if (preset === "youtube4k")
      throw new QueryError(
        "notImplemented",
        "4K HEVC export exceeds the current browser compositor's 1080p limit.",
      );
    if (!["review", "final", "short", "webm", "youtube1080"].includes(preset))
      throw new QueryError(
        "notFound",
        "Supported presets are review, youtube1080, final, short and webm.",
      );
    if (preset === "short") project = formatProject(project, "portrait");
    if (preset === "review" || preset === "youtube1080") {
      const resolution = preset === "review" ? 720 : 1080;
      const scale = resolution / Math.min(project.settings.width, project.settings.height);
      if (scale > 1)
        warnings.add(`${preset} preset upscales the project to a ${resolution}-pixel short side.`);
      project = {
        ...project,
        settings: {
          ...project.settings,
          width: Math.max(2, Math.floor((project.settings.width * scale) / 2) * 2),
          height: Math.max(2, Math.floor((project.settings.height * scale) / 2) * 2),
        },
      };
    }
    if (request.audioOnly === true) {
      if (start < 0 || end <= start || end > duration || end - start > 300)
        throw new QueryError("badRequest", "Invalid audio export range.");
      const sampleRate = 48000,
        frames = Math.round((end - start) * sampleRate),
        buffer = new ArrayBuffer(44 + frames * 4),
        view = new DataView(buffer);
      const label = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
      };
      label(0, "RIFF");
      view.setUint32(4, 36 + frames * 4, true);
      label(8, "WAVE");
      label(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 2, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 4, true);
      view.setUint16(32, 4, true);
      view.setUint16(34, 16, true);
      label(36, "data");
      view.setUint32(40, frames * 4, true);
      const began = performance.now();
      let offset = 0;
      for await (const block of mixTimelineAudio(project, reader, signal, sampleRate, 4096, end, {
        start,
        master: request.tracks == null,
        measure: async (id) => measureSource((await resource(id))!.file, await reader(id), signal),
      })) {
        signal.throwIfAborted();
        for (let i = 0; i < block.frames && offset < frames; i++, offset++)
          for (let channel = 0; channel < 2; channel++) {
            const value = Math.min(1, Math.max(-1, block.data[channel * block.frames + i] ?? 0));
            view.setInt16(
              44 + (offset * 2 + channel) * 2,
              Math.round(value * (value < 0 ? 32768 : 32767)),
              true,
            );
          }
      }
      const blob = new Blob([buffer], { type: "audio/wav" });
      return {
        data: await base64(blob),
        container: "wav",
        bytes: blob.size,
        preset,
        duration: frames / sampleRate,
        elapsed: (performance.now() - began) / 1000,
        warnings: [...warnings],
        ...(request.tracks ? { tracks: request.tracks } : {}),
      };
    }
    const { renderWebM } = await import("@sidecut/platform-browser/export"),
      began = performance.now();
    const blob = await renderWebM(project, resource, signal, () => {}, {
      start,
      end,
      master: request.tracks == null,
    });
    const plan = exportPlan(project);
    return {
      data: await base64(blob),
      bytes: blob.size,
      preset,
      width: plan.width,
      height: plan.height,
      duration: end - start,
      elapsed: (performance.now() - began) / 1000,
      warnings: [...warnings],
      ...(request.tracks ? { tracks: request.tracks } : {}),
    };
  } finally {
    for (const pending of readers.values()) {
      const opened = await pending.catch(() => null);
      opened?.close();
    }
  }
}
