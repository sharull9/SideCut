// Ported from TandemMedia/MediaScanner.swift at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
export const video = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "mpeg", "mpg"]);
export const audio = new Set([
  "wav",
  "mp3",
  "m4a",
  "aac",
  "flac",
  "ogg",
  "opus",
  "aif",
  "aiff",
  "caf",
]);
export const images = new Set(["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "heic", "svg"]);
const folders: Record<string, string> = {
  music: "music",
  songs: "music",
  score: "music",
  beds: "music",
  sfx: "sfx",
  sounds: "sfx",
  "sound effects": "sfx",
  "sound-effects": "sfx",
  soundfx: "sfx",
  broll: "broll",
  "b-roll": "broll",
  "b roll": "broll",
  b_roll: "broll",
  graphics: "graphic",
  "motion-graphics": "graphic",
  "motion graphics": "graphic",
  gfx: "graphic",
  overlays: "graphic",
  titles: "graphic",
  stickers: "sticker",
};
export function mediaRole(path: string, duration?: number) {
  const parts = path.toLowerCase().replaceAll("\\", "/").split("/");
  const name = parts.pop() ?? "",
    ext = name.includes(".") ? name.split(".").at(-1)! : "",
    stem = name.slice(0, -(ext.length + 1));
  if (video.has(ext) || audio.has(ext)) {
    if (stem.endsWith("-camera") || stem.endsWith("-audio")) return "camera";
    if (stem.endsWith("-screen")) return "screen";
  }
  for (const folder of parts.reverse()) if (folders[folder]) return folders[folder];
  const words = new Set(stem.split(/[^\p{L}\p{N}]+/u)),
    has = (values: string[]) => values.some((value) => words.has(value));
  if (video.has(ext)) {
    if (has(["camera", "cam", "webcam", "facecam"])) return "camera";
    if (has(["screen", "screencast", "screenrecording"])) return "screen";
    if (has(["broll"]) || stem.includes("b-roll")) return "broll";
  }
  if (images.has(ext) || video.has(ext))
    return words.has("sticker") ? "sticker" : images.has(ext) ? "image" : "other";
  if (audio.has(ext)) {
    if (has(["sfx", "whoosh", "swoosh", "swipe", "click", "ding", "riser", "impact"])) return "sfx";
    if (has(["music", "song", "bed", "score", "track"])) return "music";
    return duration !== undefined && duration < 10 ? "sfx" : "music";
  }
  return "other";
}
