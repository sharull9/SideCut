import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Clip } from "@sidecut/contracts/project";
import { useEditorSession } from "./editor-session";

function useSourceSamples(mediaID: string) {
  const { session, snapshot } = useEditorSession();
  const state = useSyncExternalStore(
    session.analysis.subscribe,
    session.analysis.getSnapshot,
    session.analysis.getSnapshot,
  );
  const host = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const samples = state[mediaID]?.samples;
  const available = snapshot.mediaAvailability[mediaID]?.state === "available";
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver((entries) =>
      setVisible(entries.some((entry) => entry.isIntersecting)),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (visible && available && !samples) void session.analysis.samples(mediaID).catch(() => {});
  }, [visible, available, samples, mediaID, session]);
  return { host, visible, samples };
}

/** Offscreen items never request analysis or decode cached thumbnail images. */
export function SourceSamples({
  mediaID,
  clip,
  audio = false,
}: {
  mediaID: string;
  clip?: Clip;
  audio?: boolean;
}) {
  const { host, visible, samples } = useSourceSamples(mediaID);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!visible || !samples || !element) return;
    let disposed = false,
      token = 0;
    const bitmaps = new Map<Blob, ImageBitmap>();
    const draw = async () => {
      const current = ++token;
      const bounds = host.current!.getBoundingClientRect();
      const viewport = host
        .current!.closest(".editor-timeline-scroll, .editor-panel-content")
        ?.getBoundingClientRect();
      const offset = Math.max(0, (viewport?.left ?? 0) - bounds.left);
      const visibleWidth = Math.max(
        1,
        Math.min(bounds.right, viewport?.right ?? window.innerWidth) - bounds.left - offset,
      );
      const width = Math.min(2048, Math.max(1, Math.round(visibleWidth))),
        height = 24;
      element.style.position = "absolute";
      element.style.left = `${offset}px`;
      element.style.width = `${visibleWidth}px`;
      element.width = width;
      element.height = height;
      const ctx = element.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, width, height);
      const start = clip?.sourceStart.seconds ?? 0,
        length = clip ? clip.duration.seconds * clip.speed : samples.duration;
      if (audio) {
        ctx.fillStyle = getComputedStyle(element).color;
        for (let x = 0; x < width; x++) {
          const from = Math.max(
            0,
            Math.floor(
              (start + (length * (offset + (x / width) * visibleWidth)) / bounds.width) *
                samples.peaksPerSecond,
            ),
          );
          const to = Math.min(
            samples.peaks.length,
            Math.max(
              from + 1,
              Math.ceil(
                (start + (length * (offset + ((x + 1) / width) * visibleWidth)) / bounds.width) *
                  samples.peaksPerSecond,
              ),
            ),
          );
          let peak = 0;
          for (let i = from; i < to; i++) peak = Math.max(peak, samples.peaks[i]!);
          ctx.fillRect(x, 12 - peak * 11, 1, Math.max(1, peak * 22));
        }
      } else
        for (let x = 0; x < width; x += 44) {
          const time = clip?.freezeFrame
            ? start
            : start + (length * (offset + (x / width) * visibleWidth)) / bounds.width;
          if (time < 0 || (samples.duration && time >= samples.duration)) continue;
          const thumbnail =
            samples.thumbnails.findLast((t) => t.time <= time) ?? samples.thumbnails[0];
          if (!thumbnail) continue;
          let bitmap = bitmaps.get(thumbnail.image);
          if (!bitmap) {
            bitmap = await createImageBitmap(thumbnail.image);
            if (disposed) {
              bitmap.close();
              return;
            }
            bitmaps.set(thumbnail.image, bitmap);
          }
          if (disposed || current !== token) return;
          ctx.drawImage(bitmap, x, 0, 43, height);
        }
    };
    const observer = new ResizeObserver(() => {
      void draw();
    });
    observer.observe(host.current!);
    let animation = 0;
    const scroll = () => {
      cancelAnimationFrame(animation);
      animation = requestAnimationFrame(() => {
        void draw();
      });
    };
    window.addEventListener("scroll", scroll, true);
    void draw();
    return () => {
      disposed = true;
      token++;
      observer.disconnect();
      cancelAnimationFrame(animation);
      window.removeEventListener("scroll", scroll, true);
      for (const bitmap of bitmaps.values()) bitmap.close();
    };
  }, [host, samples, visible, clip, audio]);
  return (
    <span ref={host} className="editor-source-samples" aria-hidden="true">
      {visible && <canvas ref={canvas} />}
    </span>
  );
}

/** One still per source: the first thumbnail for picture, the whole-file waveform for sound. */
export function MediaThumb({ mediaID, audio = false }: { mediaID: string; audio?: boolean }) {
  const { host, visible, samples } = useSourceSamples(mediaID);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!visible || !samples || !element) return;
    let disposed = false;
    const width = 320,
      height = 180;
    element.width = width;
    element.height = height;
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (audio) {
      const count = samples.peaks.length;
      if (!count) return;
      ctx.fillStyle = getComputedStyle(element).color;
      for (let x = 0; x < width; x += 3) {
        const from = Math.floor((x / width) * count),
          to = Math.max(from + 1, Math.floor(((x + 3) / width) * count));
        let peak = 0;
        for (let i = from; i < to && i < count; i++) peak = Math.max(peak, samples.peaks[i]!);
        const bar = Math.max(4, peak * height * 0.8);
        ctx.fillRect(x, (height - bar) / 2, 2, bar);
      }
      return;
    }
    const thumbnail = samples.thumbnails[0];
    if (!thumbnail) return;
    void createImageBitmap(thumbnail.image).then((bitmap) => {
      if (disposed) {
        bitmap.close();
        return;
      }
      const scale = Math.max(width / bitmap.width, height / bitmap.height);
      const w = bitmap.width * scale,
        h = bitmap.height * scale;
      ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
      bitmap.close();
    });
    return () => {
      disposed = true;
    };
  }, [samples, visible, audio]);
  return (
    <span ref={host} className="editor-media-thumb-art" aria-hidden="true">
      {visible && <canvas ref={canvas} />}
    </span>
  );
}
