// Ported from TandemImport/Filmora at 735a9b8. See tests/fixtures/tandem/TANDEM-LICENSE.
import { list, object, number, type ObjectValue } from "./import-builder";
import { filmoraString, filmoraTicks } from "./filmora-values";
import { filmoraEdge, type FilmoraEdge } from "./filmora-transitions";
import { filmoraVideo, filmoraEffects, type FilmoraProperties } from "./filmora-properties";
import { DEFAULT_TEXT_STYLE, textAnimation } from "./text";

type Transform = { position: { x: number; y: number }; scale: number };
export type FilmoraInput = {
  node: ObjectValue;
  begin: number;
  end: number;
  shift: number;
  template?: string;
  transform?: Transform;
  flattened: boolean;
  head?: FilmoraEdge;
  tail?: FilmoraEdge;
};
export function expandFilmoraTimeline(
  main: ObjectValue,
  timelines: readonly ObjectValue[],
  frame: number,
  warnings: string[],
) {
  const sounds: FilmoraInput[] = [],
    soundKeys = new Set<string>();
  let count = 0;
  const expand = (
    node: ObjectValue,
    shift: number,
    window: { from: number; to: number } | undefined,
    depth: number,
    template?: string,
    transform?: Transform,
    soundOnly = false,
  ): FilmoraInput[] => {
    if (++count > 10000) throw new Error("Expanded Filmora timeline exceeds 10000 clips.");
    const originalBegin = number(node.tlBegin),
      originalEnd = number(node.tlEnd) + 1;
    filmoraTicks(originalBegin);
    filmoraTicks(originalEnd);
    filmoraTicks(shift);
    const begin = Math.max(originalBegin, window?.from ?? originalBegin),
      end = Math.min(originalEnd, window?.to ?? originalEnd);
    if (end <= begin) return [];
    const head =
      begin === originalBegin ? filmoraEdge(node.preTransition, originalBegin, frame) : undefined;
    const tail =
      end === originalEnd ? filmoraEdge(node.postTransition, originalEnd, frame) : undefined;
    const type = Number(node.type);
    if (![6, 7, 16].includes(type)) {
      if (soundOnly && ![2, 15].includes(type)) return [];
      return [
        {
          node,
          begin,
          end,
          shift,
          flattened: shift !== 0 || window != null,
          ...(template ? { template } : {}),
          ...(transform ? { transform } : {}),
          ...(head ? { head } : {}),
          ...(tail ? { tail } : {}),
        },
      ];
    }
    const nested = timelines.find((t) => t.timelineId === node.timelineId);
    if (depth >= 4 || !nested) {
      warnings.push("A template or compound clip with nothing readable inside was left out.");
      return [];
    }
    const metadata = filmoraString(node, 12);
    const resource = metadata ? object(JSON.parse(metadata)) : {};
    const name =
      filmoraString(node, 50) ??
      (typeof resource.name === "string"
        ? resource.name.replace(/_\d{10,}$/, "").replaceAll("_", " ")
        : "template");
    if (type !== 7 && type !== 16 && resource.res_type !== 1)
      warnings.push(`Template "${name}" was flattened into its layers and sounds.`);
    const offset = number(node.inPoint, 0),
      childShift = shift + originalBegin - offset;
    const childWindow = { from: begin - originalBegin + offset, to: end - originalBegin + offset };
    const soundKey = `${String(node.timelineId)}@${originalBegin + shift}`,
      takeSound = !soundKeys.has(soundKey);
    soundKeys.add(soundKey);
    let parentTransform = transform;
    if (node.effectChainList != null) {
      const video = filmoraVideo(
        node,
        {
          id: "template",
          duration: (end - begin) / 10000000,
          sourceStart: offset / 10000000,
          speed: 1,
          camera: false,
        },
        warnings,
      );
      const t = object(video.video.transform),
        position = object(t.position);
      const own = {
        position: { x: number(position.x), y: number(position.y) },
        scale: number(t.scale),
      };
      if (
        Number(t.rotation ?? 0) !== 0 ||
        Number(video.video.opacity ?? 1) !== 1 ||
        Object.keys(video.keyframes).length ||
        (Array.isArray(video.video.effects) && video.video.effects.length)
      )
        warnings.push(
          "Template rotation, opacity, effects and parent animation aren't applied to flattened children.",
        );
      parentTransform = transform
        ? {
            position: {
              x: transform.position.x + (own.position.x - 0.5) * transform.scale,
              y: transform.position.y + (own.position.y - 0.5) * transform.scale,
            },
            scale: transform.scale * own.scale,
          }
        : own;
    }
    const layers: FilmoraInput[] = [];
    for (const rawTrack of list(nested.trackInfos))
      for (const rawChild of list(object(rawTrack).clipList ?? [])) {
        const child = object(rawChild),
          childType = Number(child.type);
        if (type === 16 || soundOnly) {
          if (takeSound)
            sounds.push(
              ...expand(
                child,
                childShift,
                childWindow,
                depth + 1,
                "filmora-template-sound",
                undefined,
                true,
              ),
            );
        } else if ([2, 15].includes(childType)) {
          if (takeSound) sounds.push(...expand(child, childShift, childWindow, depth + 1, name));
        } else
          layers.push(...expand(child, childShift, childWindow, depth + 1, name, parentTransform));
      }
    for (const layer of layers) {
      if (!layer.head && layer.begin + layer.shift === begin + shift && head) layer.head = head;
      if (!layer.tail && layer.end + layer.shift === end + shift && tail) layer.tail = tail;
    }
    return layers;
  };
  const tracks = list(main.trackInfos).map((raw) => {
    const node = object(raw);
    return {
      node,
      inputs: list(node.clipList ?? []).flatMap((c) => expand(object(c), 0, undefined, 0)),
    };
  });
  if (sounds.length) tracks.push({ node: { trackType: 2, templateSounds: true }, inputs: sounds });
  return tracks;
}

function rgba(value: unknown, alpha = 255) {
  if (value == null || number(value) < 0) return undefined;
  const n = number(value);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
    a: Math.min(1, Math.max(0, alpha / 255)),
  };
}
export function filmoraTitle(input: FilmoraInput, warnings: string[]) {
  const node = input.node;
  for (const effect of filmoraEffects(node))
    if (
      effect.on &&
      Object.keys(effect.params).length &&
      !["video/effect/transform", "video/effect/crop-pan-zoom"].includes(effect.id)
    )
      warnings.push(`Title effect "${effect.display}" isn't supported.`);
  if (node.scriptBuf == null) {
    warnings.push("A title had no text data.");
    return null;
  }
  const script = object(
    typeof node.scriptBuf === "string" ? JSON.parse(node.scriptBuf) : node.scriptBuf,
  );
  const data = object(list(script.TextData ?? [])[0] ?? {}),
    basic = object(data.Basic ?? {}),
    border = object(data.Border ?? {}),
    shadow = object(data.Shadow ?? {}),
    background = object(script.Background ?? {}),
    layout = object(script.Layout ?? {});
  const text = String(script.Text ?? data.CharData ?? "").replace(/\r\n?/g, "\n");
  const font = String(basic.FontName ?? DEFAULT_TEXT_STYLE.font),
    lower = font.toLowerCase();
  const weight = /black|heavy/.test(lower)
    ? 900
    : /extra.?bold/.test(lower)
      ? 800
      : /semi.?bold/.test(lower)
        ? 600
        : lower.includes("bold") || basic.FontBold === true
          ? 700
          : lower.includes("medium")
            ? 500
            : lower.includes("light")
              ? 300
              : lower.includes("thin")
                ? 100
                : 400;
  const color = object(list(basic.TextColor ?? [])[0] ?? {}).Color;
  const style: FilmoraProperties = {
    font,
    weight,
    color: rgba(color, number(basic.TextAlpha, 255)) ?? { r: 1, g: 1, b: 1, a: 1 },
    shadow: shadow.Enable === true,
    uppercase: data.CharCase === 1,
  };
  if (border.Enable === true && number(border.Size, 0) > 0) {
    style.strokeWidth = number(border.Size);
    style.strokeColor = rgba(border.Color, number(border.Alpha, 255)) ?? { r: 0, g: 0, b: 0, a: 1 };
  }
  const backgroundColor =
    background.Enable === true ? rgba(background.Color, number(background.Alpha, 255)) : undefined;
  if (backgroundColor) style.backgroundColor = backgroundColor;
  if (
    typeof layout.TextAlign === "string" &&
    ["left", "center", "right"].includes(layout.TextAlign.toLowerCase())
  )
    style.alignment = layout.TextAlign.toLowerCase();
  if (number(script.ScaleY, 0) > 0)
    style.size = Math.round(
      ((number(script.ScaleY) * 1080) / text.split("\n").length / 1.2) * 0.85,
    );
  else if (basic.FontSize != null) style.size = number(basic.FontSize);
  const content: FilmoraProperties = { text, style };
  for (const entering of [true, false]) {
    const animation = node[entering ? "inAnimation" : "outAnimation"];
    if (animation == null) continue;
    const a = object(animation),
      name = String(a.name ?? "").toLowerCase();
    if (!name) continue;
    const mapped = /typewriter|verbatim/.test(name)
      ? entering
        ? "typewriter"
        : undefined
      : /fade|gradually/.test(name)
        ? entering
          ? "fadeIn"
          : "fadeOut"
        : /pop|bounce|flash/.test(name)
          ? entering
            ? "popIn"
            : "popOut"
          : name.includes("up")
            ? entering
              ? "slideUp"
              : "slideDown"
            : name.includes("down")
              ? entering
                ? "slideDown"
                : "slideUp"
              : /slide|insert/.test(name)
                ? entering
                  ? "slideUp"
                  : "slideDown"
                : undefined;
    if (mapped) content[entering ? "animationIn" : "animationOut"] = mapped;
    else warnings.push(`Title animation "${String(a.name)}" has no Tandem equivalent.`);
    if (mapped && !textAnimation(mapped))
      warnings.push(`Title animation ${mapped} is retained but isn't rendered by SideCut.`);
    if (a.duration != null && (entering || content.animationIn == null))
      content.animationDuration = filmoraTicks(a.duration);
  }
  if (script.Stt != null || node.isSubtitleText === true)
    warnings.push("Caption word timings weren't carried over; the caption text was.");
  if (
    [
      "text here",
      "title here",
      "enter text here",
      "your text here",
      "enter title here",
      "subtitle here",
    ].includes(text.trim().toLowerCase())
  )
    warnings.push(`A title still says "${text}", Filmora's placeholder text.`);
  const parent = input.transform;
  const x = number(script.PosX, 0.5),
    y = number(script.PosY, 0.5);
  if (parent && parent.scale !== 1)
    style.size = Math.round(number(style.size, DEFAULT_TEXT_STYLE.size) * parent.scale);
  warnings.push("Title sizes are estimated from Filmora's text box; fonts and colours carry over.");
  return {
    name: text.replaceAll("\n", " ").slice(0, 40),
    content: { text: content },
    video: {
      transform: {
        position: parent
          ? {
              x: parent.position.x + (x - 0.5) * parent.scale,
              y: parent.position.y + (y - 0.5) * parent.scale,
            }
          : { x, y },
        scale: 1,
        rotation: number(layout.Angle, 0),
      },
    },
  };
}
