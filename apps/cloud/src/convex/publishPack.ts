import { ConvexError } from "convex/values";
import type { Infer } from "convex/values";
import type { publishPayload } from "./schema";

export function validatePublishPayload(payload: Infer<typeof publishPayload>) {
  if (
    !payload.title.trim() ||
    payload.title.length > 200 ||
    payload.description.length > 5000 ||
    payload.words.length > 1000 ||
    payload.chapters.length > 100 ||
    JSON.stringify(payload).length > 50000
  )
    throw new ConvexError("Publish payload exceeds its limits.");
  let end = 0;
  for (const word of payload.words) {
    if (
      !word.text.trim() ||
      word.text.length > 200 ||
      /[\r\n]/.test(word.text) ||
      !Number.isFinite(word.start) ||
      !Number.isFinite(word.end) ||
      word.start < end ||
      word.end <= word.start ||
      Math.round(word.end * 1000) <= Math.round(word.start * 1000) ||
      word.end > 86400
    )
      throw new ConvexError("Invalid publish transcript.");
    end = word.end;
  }
  let previous = -1;
  for (const chapter of payload.chapters) {
    if (
      !chapter.title.trim() ||
      chapter.title.length > 200 ||
      /[\r\n]/.test(chapter.title) ||
      !Number.isFinite(chapter.start) ||
      !Number.isInteger(chapter.start) ||
      chapter.start < 0 ||
      chapter.start <= previous ||
      chapter.start > end
    )
      throw new ConvexError("Invalid publish chapters.");
    previous = chapter.start;
  }
}

export function publishPayloadKey(payload: Infer<typeof publishPayload>) {
  return JSON.stringify([
    payload.title,
    payload.description,
    payload.words.map((word) => [word.text, word.start, word.end]),
    payload.chapters.map((chapter) => [chapter.title, chapter.start]),
  ]);
}

function clock(seconds: number, srt: boolean) {
  const ms = Math.round(seconds * 1000);
  const whole = Math.floor(ms / 1000);
  return `${String(Math.floor(whole / 3600)).padStart(2, "0")}:${String(Math.floor(whole / 60) % 60).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}${srt ? `,${String(ms % 1000).padStart(3, "0")}` : ""}`;
}

/** Deterministic packaging of user-authored metadata and transcript; no model or publication. */
export function publishPackStep(payload: Infer<typeof publishPayload>, step: number) {
  validatePublishPayload(payload);
  if (step === 0)
    return [
      {
        name: "transcript.txt",
        type: "text/plain",
        text: payload.words.map((w) => w.text).join(" "),
      },
      {
        name: "captions.srt",
        type: "application/x-subrip",
        text: payload.words
          .map(
            (w, i) =>
              `${i + 1}\n${clock(w.start, true)} --> ${clock(w.end, true)}\n${w.text.replace(/[<>]/g, "")}\n`,
          )
          .join("\n"),
      },
    ];
  if (step === 1)
    return [
      {
        name: "metadata.json",
        type: "application/json",
        text: JSON.stringify({
          title: payload.title,
          description: payload.description,
          generatedByAI: false,
        }),
      },
      {
        name: "chapters.txt",
        type: "text/plain",
        text: payload.chapters.map((c) => `${clock(c.start, false)} ${c.title}`).join("\n"),
      },
    ];
  throw new ConvexError("Invalid publish checkpoint.");
}
