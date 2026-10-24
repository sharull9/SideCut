// Ported from TandemImport/Filmora at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
import { Time, flicksPerFrame } from "@sidecut/contracts/time";
import type { Transition, Project } from "@sidecut/contracts/project";
import { object, number, type ObjectValue } from "./import-builder";

export type FilmoraEdge = { name: string; duration: number; spansCut: boolean; offCentre: boolean };
export function filmoraEdge(value: unknown, cut: number, frame: number): FilmoraEdge | undefined {
  if (value == null) return;
  const node = object(value);
  if (node.tlBegin == null || node.tlEnd == null) return;
  const begin = number(node.tlBegin),
    end = number(node.tlEnd) + 1;
  if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end))
    throw new Error("Invalid Filmora transition ticks.");
  if (end <= begin) return;
  return {
    name: String(node.display ?? node.id ?? "transition"),
    duration: (end - begin) / 10000000,
    spansCut: begin < cut && end > cut,
    offCentre: begin < cut && end > cut && Math.abs(cut - begin - (end - cut)) / 10000000 > frame,
  };
}
export function mapFilmoraTransition(
  name: string,
  audio: boolean,
  placement: "head" | "tail" | "between",
) {
  const lower = name.toLowerCase(),
    words = lower.replaceAll("_", " ").split(" ");
  const direction = (["left", "right", "up", "down"] as const).find((d) => words.includes(d));
  const mapped = (type: Transition["type"], exact: boolean, dir?: Transition["direction"]) => ({
    type,
    exact,
    ...(dir ? { direction: dir } : {}),
  });
  if (audio) return mapped("dissolve", /audio fade|constant gain|crossfade/.test(lower));
  if (lower.includes("cut slide")) return mapped("cutSlide", true, direction);
  if (/fade_black|fade to black|dip to black/.test(lower) || lower === "fade black")
    return mapped(placement === "head" ? "fadeFromBlack" : "fadeToBlack", true);
  if (lower.includes("push"))
    return mapped("push", direction != null || lower === "push", direction ?? "left");
  if (/dissolve|cross fade|crossfade/.test(lower) || lower === "fade")
    return mapped("dissolve", true);
  if (lower.includes("wipe")) return mapped("wipe", direction != null, direction ?? "left");
  if (lower.includes("slid")) return mapped("slide", direction != null, direction ?? "left");
  return mapped(lower.includes("zoom") ? "zoom" : "dissolve", false);
}
type TransitionClip = {
  id: string;
  start: number;
  duration: number;
  sourceStart: number;
  speed: number;
  content: ObjectValue;
  head?: FilmoraEdge;
  tail?: FilmoraEdge;
};
export function filmoraTransitions(
  clips: readonly TransitionClip[],
  audio: boolean,
  media: ReadonlyMap<string, ObjectValue>,
  rate: Project["settings"]["frameRate"],
  warnings: string[],
) {
  const transitions: Transition[] = [],
    heads = new Set<string>(),
    tails = new Set<string>();
  const frame = Number(flicksPerFrame(rate)) / 705600000;
  const end = (c: TransitionClip) => Time.fromSeconds(c.start + c.duration).flicks;
  const item = (c: TransitionClip) => {
    const reference = c.content.media;
    return reference ? media.get(String(object(reference).mediaID)) : undefined;
  };
  const add = (
    edge: FilmoraEdge,
    from: TransitionClip | undefined,
    to: TransitionClip | undefined,
  ) => {
    const mapped = mapFilmoraTransition(
      edge.name,
      audio,
      from && to ? "between" : to ? "head" : "tail",
    );
    if (!mapped.exact)
      warnings.push(`Transition "${edge.name}" plays as ${audio ? "a crossfade" : mapped.type}.`);
    let duration = edge.duration;
    if (from && to) {
      if (edge.offCentre) warnings.push("An off-centre transition was centred on its cut.");
      if (item(to)?.kind === "image") {
        warnings.push("Transitions into a still image aren't supported; it cuts in.");
        return false;
      }
      const source = item(from),
        incoming = item(to);
      const after =
        source?.duration == null
          ? from.duration
          : Math.max(
              0,
              (number(source.duration) - from.sourceStart - from.duration * from.speed) /
                from.speed,
            );
      const before = incoming ? to.sourceStart / to.speed : to.duration;
      const available = Math.min(after, before, from.duration, to.duration);
      if (duration / 2 > available) {
        const frames = Math.floor((available + 1e-9) / frame);
        if (frames < 1) {
          warnings.push("A transition was left out: its clips have no media beyond the cut.");
          return false;
        }
        duration = frames * frame * 2;
        warnings.push("A transition was shortened to fit the media either side of its cut.");
      }
    } else duration = Math.min(duration, (from ?? to)!.duration);
    transitions.push({
      id: `tr_wfp_${from?.id ?? "head"}_${to?.id ?? "tail"}`,
      type: mapped.type,
      ...(mapped.direction ? { direction: mapped.direction } : {}),
      duration: Time.fromSeconds(duration).seconds,
      ...(from ? { fromClipID: from.id } : {}),
      ...(to ? { toClipID: to.id } : {}),
    });
    if (from) tails.add(from.id);
    if (to) heads.add(to.id);
    return true;
  };
  for (const [i, clip] of clips.entries()) {
    const next = clips[i + 1],
      previous = clips[i - 1];
    if (clip.tail && !tails.has(clip.id)) {
      if (
        clip.tail.spansCut &&
        next &&
        end(clip) === Time.fromSeconds(next.start).flicks &&
        !heads.has(next.id)
      )
        add(clip.tail, clip, next);
      else add(clip.tail, clip, undefined);
    }
    if (clip.head && !heads.has(clip.id)) {
      if (
        clip.head.spansCut &&
        previous &&
        end(previous) === Time.fromSeconds(clip.start).flicks &&
        !tails.has(previous.id)
      )
        add(clip.head, previous, clip);
      else add(clip.head, undefined, clip);
    }
  }
  return transitions;
}
