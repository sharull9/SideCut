import { describe, it, expect } from "vite-plus/test";
import { decodeProjectFile, encodeProjectFile, markerKind } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { CommentEdits, comments, oneLine } from "./markers";
import {
  CardMotion,
  cardOf,
  cardProps,
  fittedDuration,
  kickerLine,
  readCardProps,
} from "./section-cards";
import { BUILT_IN_TEMPLATES } from "./templates";
import { clipInFormat, fillingTransform } from "./formats";
import { planShort } from "./short";

const roundTrip = (c: ProjectCoordinator) =>
  decodeProjectFile(
    JSON.parse(encodeProjectFile({ revision: 0, project: c.getSnapshot().project })),
  ).project;
function session(extra: Record<string, unknown> = {}) {
  return new ProjectCoordinator(
    decodeProjectFile({
      revision: 0,
      project: {
        settings: { width: 1920, height: 1080, frameRate: { numerator: 30, denominator: 1 } },
        media: [
          {
            id: "cam",
            path: "cam.mp4",
            kind: "video",
            role: "camera",
            width: 1920,
            height: 1080,
            hasAudio: true,
            duration: 60,
          },
          {
            id: "scr",
            path: "scr.mp4",
            kind: "video",
            role: "screen",
            width: 2560,
            height: 1440,
            duration: 60,
          },
          { id: "whoosh", path: "whoosh.wav", kind: "audio", role: "sfx", duration: 1.2 },
        ],
        videoTracks: [
          {
            id: "camera",
            kind: "video",
            name: "Camera",
            clips: [
              { id: "c", duration: 30, content: { media: { mediaID: "cam" } }, linkGroup: "take" },
            ],
          },
        ],
        audioTracks: [
          {
            id: "voice",
            kind: "audio",
            name: "Voice",
            clips: [
              { id: "v", duration: 30, content: { media: { mediaID: "cam" } }, linkGroup: "take" },
            ],
          },
        ],
        ...extra,
      },
    }),
  );
}

describe("markers and comments", () => {
  it("adds, updates and removes ranged review markers that ripple, save and undo", () => {
    const c = session();
    c.apply({
      commands: [
        {
          addMarker: {
            marker: { id: "mk_a", time: 10, duration: 4, name: "Intro", kind: "chapter" },
          },
        },
        {
          addMarker: {
            marker: { id: "mk_b", time: 20, name: "Fix audio", kind: "todo", note: "hum" },
          },
        },
      ],
    });
    c.apply({ commands: [{ updateMarker: { markerID: "mk_b", patch: { time: 2, note: null } } }] });
    expect(c.getSnapshot().project.markers.map((m) => [m.id, m.time, m.note ?? null])).toEqual([
      ["mk_b", 2, null],
      ["mk_a", 10, null],
    ]);
    c.apply({ commands: [{ rippleDeleteRange: { range: { start: 11, duration: 2 } } }] });
    expect(c.getSnapshot().project.markers[1]).toMatchObject({ time: 10, duration: 2 });
    const comment = CommentEdits.add("  cut the umm\n\n here ", 5, "mk_c")!;
    c.apply(comment);
    const saved = roundTrip(c);
    expect(comments(saved).map((m) => m.name)).toEqual(["cut the umm\n\n here"]);
    expect(oneLine(comments(saved)[0]!.name)).toBe("cut the umm / here");
    c.apply(CommentEdits.edit(comments(saved)[0]!, " ")!);
    expect(comments(c.getSnapshot().project)).toEqual([]);
    c.undo();
    expect(comments(c.getSnapshot().project)).toHaveLength(1);
    c.apply({ commands: [{ removeMarker: { markerID: "mk_a" } }] });
    expect(() => c.apply({ commands: [{ removeMarker: { markerID: "mk_a" } }] })).toThrow(
      /not found/,
    );
    expect(() =>
      c.apply({ commands: [{ addMarker: { marker: { id: "mk_b", time: 1 } } }] }),
    ).toThrow(/already in use/);
  });
  it("keeps a kind from a newer Tandem and reads it as a plain marker", () => {
    const c = session({ markers: [{ id: "mk_x", time: 1, kind: "highlight" }] });
    const marker = roundTrip(c).markers[0]!;
    expect([marker.kind, markerKind(marker), marker.name]).toEqual(["highlight", "marker", ""]);
  });
});

describe("section cards", () => {
  it("fits cards to their words and covers the frame like the reference", () => {
    expect(
      fittedDuration(cardProps({ title: "Methodology", subtitle: "Let's keep it fair" })).seconds,
    ).toBe(4.2);
    expect(
      fittedDuration(
        cardProps({ title: "The one I would turn on", subtitle: "Require access control" }),
      ).seconds,
    ).toBe(5.3);
    const covered = new CardMotion(3.2, 9 / 16).covered!;
    expect(covered[0]).toBeCloseTo(0.42, 2);
    expect(3.2 - covered[1]).toBeCloseTo(0.41, 2);
    expect(kickerLine(cardProps({ kicker: "Tip", number: "02", total: 3 }))).toBe("Tip 2 of 3");
    expect(
      readCardProps({ number: 3, total: "14", cursor: "off", accent: "#FF0000" }),
    ).toMatchObject({
      number: "03",
      total: 14,
      cursor: false,
      colors: { accent: { r: 1, g: 0, b: 0, a: 1 } },
    });
  });
  it("places numbered cards over section markers with linked whooshes", () => {
    const c = session({
      markers: [
        { id: "cold", time: 0, name: "Cold open", kind: "section" },
        { id: "s1", time: 6, name: "Methodology", kind: "section", note: "Let's keep it fair" },
        { id: "s2", time: 16, name: "Results", kind: "section" },
      ],
    });
    c.apply({
      commands: [
        {
          addSectionCards: {
            kicker: "Section",
            soundIn: { mediaID: "whoosh" },
            soundOut: { mediaID: "whoosh", gainDB: -10 },
          },
        },
      ],
    });
    const p = c.getSnapshot().project;
    const graphics = p.videoTracks.find((t) => t.name === "Graphics")!;
    expect(graphics.rippleMode).toBe("follow");
    const cards = graphics.clips.map((clip) => [
      clip.start.seconds,
      cardOf(clip)!.number,
      cardOf(clip)!.title,
    ]);
    expect(cards.map(([, n, t]) => [n, t])).toEqual([
      ["01", "Methodology"],
      ["02", "Results"],
    ]);
    // The card hides the whole frame from the marker on, starting on a frame.
    expect(cards[0]![0]).toBeCloseTo(6 - 0.42, 1);
    expect(Number.isInteger(Math.round((cards[0]![0] as number) * 30 * 1e6) / 1e6)).toBe(true);
    const sfx = p.audioTracks.find((t) => t.name === "SFX")!;
    expect(sfx.clips).toHaveLength(4);
    expect(sfx.clips.map((s) => s.audio?.gainDB)).toEqual([-15, -10, -15, -10]);
    expect(sfx.clips[0]!.linkGroup).toBe(graphics.clips[0]!.linkGroup);
    // Running again finds the cards and renumbers them instead of adding more.
    c.apply({ commands: [{ addSectionCards: { markerIDs: ["s2"] } }] });
    const again = c.getSnapshot().project.videoTracks.find((t) => t.name === "Graphics")!;
    expect(again.clips.map((clip) => [cardOf(clip)!.number, cardOf(clip)!.total])).toEqual([
      ["01", 2],
      ["01", 1],
    ]);
  });
  it("refits a card when its words change and moves its sweep-out sound", () => {
    const c = session({ markers: [{ id: "s1", time: 6, name: "Go", kind: "section" }] });
    c.apply({ commands: [{ addSectionCards: { soundOut: { mediaID: "whoosh" } } }] });
    const before = c.getSnapshot().project;
    const card = before.videoTracks.find((t) => t.name === "Graphics")!.clips[0]!;
    expect(card.duration.seconds).toBe(4);
    const soundBefore = before.audioTracks.find((t) => t.name === "SFX")!.clips[0]!.start.seconds;
    const title = "The one I would turn on";
    c.apply({
      commands: [
        {
          updateClip: {
            clipID: card.id,
            patch: {
              content: { graphic: { props: { title, subtitle: "Require access control" } } },
            },
          },
        },
        { fitSectionCards: {} },
      ],
    });
    const after = c.getSnapshot().project;
    const fitted = after.videoTracks.find((t) => t.name === "Graphics")!.clips[0]!;
    expect([fitted.start.seconds, cardOf(fitted)!.title]).toEqual([card.start.seconds, title]);
    expect(fitted.duration.seconds).toBeGreaterThan(5);
    const soundAfter = after.audioTracks.find((t) => t.name === "SFX")!.clips[0]!.start.seconds;
    expect(soundAfter - soundBefore).toBeCloseTo(fitted.duration.seconds - 4, 4);
  });
  it("makes room on insert and moves the section marker past the cut", () => {
    const c = session({ markers: [{ id: "s1", time: 6, name: "Go", kind: "section" }] });
    c.apply({ commands: [{ addSectionCards: { mode: "insert", duration: 3.2 } }] });
    const p = c.getSnapshot().project;
    const card = p.videoTracks.find((t) => t.name === "Graphics")!.clips[0]!;
    const marker = p.markers[0]!;
    const camera = p.videoTracks[0]!.clips;
    // The take is cut at the marker and the next shot starts as the wipe out shows it.
    expect(camera.map((clip) => clip.start.seconds)).toEqual([0, camera[1]!.start.seconds]);
    expect(camera[0]!.duration.seconds).toBe(6);
    expect(marker.time).toBeCloseTo(camera[1]!.start.seconds, 6);
    expect(card.start.seconds).toBeLessThan(6);
    expect(card.start.seconds + card.duration.seconds).toBeGreaterThan(marker.time);
    c.undo();
    expect(c.getSnapshot().project.markers[0]!.time).toBe(6);
  });
});

describe("templates", () => {
  it("inserts built-ins repeatedly without ID collisions, keeping links and tags", () => {
    const c = session();
    const callout = BUILT_IN_TEMPLATES[1];
    c.apply({ commands: [{ insertTemplate: { template: callout, at: 1 } }] });
    c.apply({ commands: [{ insertTemplate: { template: callout, at: 5 } }] });
    c.apply({
      commands: [
        {
          insertTemplate: {
            template: BUILT_IN_TEMPLATES[0],
            at: 10,
            values: { title: "Setup", number: "02" },
          },
        },
      ],
    });
    const p = c.getSnapshot().project;
    const text = p.videoTracks.find((t) => t.name === "Text")!.clips;
    expect(text.map((clip) => [clip.start.seconds, clip.tags])).toEqual([
      [1, ["template:likeAndSubscribe"]],
      [5, ["template:likeAndSubscribe"]],
    ]);
    expect(text[0]!.id).not.toBe(text[1]!.id);
    const card = p.videoTracks.find((t) => t.name === "Graphics")!.clips[0]!;
    expect(cardOf(card)).toMatchObject({ title: "Setup", number: "02", subtitle: "Who's on top" });
    expect(card.id).not.toBe("clip_sectioncard");
  });
  it("retains links, effects, carried media and transitions", () => {
    const template = {
      id: "intro",
      name: "Intro",
      duration: 2,
      clips: [
        {
          track: "Camera",
          clip: {
            content: { solid: { color: { r: 1, g: 0, b: 0 } } },
            duration: 1,
            video: { effects: [{ id: "fx", type: "blur", params: { radius: 4 } }] },
          },
        },
        {
          track: "Camera",
          offset: 1,
          clip: { content: { solid: { color: { r: 0, g: 0, b: 1 } } }, duration: 1 },
        },
        {
          track: "SFX",
          trackKind: "audio",
          offset: 0.5,
          clip: { duration: 1 },
          media: {
            id: "med_hit",
            path: "hit.wav",
            kind: "audio",
            duration: 1,
            credits: "CC0 by someone",
          },
        },
      ],
      transitions: [{ from: 0, to: 1, type: "dissolve", sound: 2 }],
    };
    const c = session({ videoTracks: [] });
    c.apply({ commands: [{ insertTemplate: { template, at: 0 } }] });
    c.apply({ commands: [{ insertTemplate: { template, at: 4 } }] });
    const p = roundTrip(c);
    const clips = p.videoTracks[0]!.clips;
    expect(
      new Set([...clips, ...p.audioTracks.find((t) => t.name === "SFX")!.clips].map((x) => x.id))
        .size,
    ).toBe(6);
    expect(clips[0]!.linkGroup).toBe(clips[1]!.linkGroup);
    expect(clips[0]!.linkGroup).not.toBe(clips[2]!.linkGroup);
    expect(clips[0]!.video?.effects).toEqual([{ id: "fx", type: "blur", params: { radius: 4 } }]);
    expect(p.media.filter((m) => m.path === "hit.wav")).toEqual([
      expect.objectContaining({ id: "med_hit", credits: "CC0 by someone" }),
    ]);
    expect(p.videoTracks[0]!.transitions).toHaveLength(2);
    expect(p.videoTracks[0]!.transitions[0]).toMatchObject({ type: "dissolve", duration: 0.5 });
  });
});

it("remaps carried template media IDs that collide with review markers", () => {
  const c = session({
    markers: [{ id: "carried", time: 1, kind: "comment", name: "Keep this note" }],
  });
  c.apply({
    commands: [
      {
        insertTemplate: {
          at: 0,
          template: {
            id: "audio",
            duration: 1,
            clips: [
              {
                track: "SFX",
                trackKind: "audio",
                offset: 0,
                clip: { duration: 1 },
                media: {
                  id: "carried",
                  path: "new.wav",
                  kind: "audio",
                  duration: 1,
                  credits: "CC0",
                },
              },
            ],
          },
        },
      },
    ],
  });
  const p = roundTrip(c);
  const added = p.media.find((m) => m.path === "new.wav")!;
  expect(added.id).not.toBe("carried");
  expect(added.credits).toBe("CC0");
  expect(p.markers[0]!.id).toBe("carried");
  expect(p.audioTracks.find((t) => t.name === "SFX")!.clips[0]!.content.media).toEqual({
    mediaID: added.id,
  });
  c.undo();
  expect(c.getSnapshot().project.media.some((m) => m.path === "new.wav")).toBe(false);
});

describe("alternate formats", () => {
  it("lays out the short and adopts it with keyframe geometry", () => {
    const c = session();
    c.apply({
      commands: [
        {
          insertClip: {
            trackID: "Camera",
            clip: { id: "s", start: 40, duration: 5, content: { media: { mediaID: "scr" } } },
          },
        },
        {
          updateClip: {
            clipID: "c",
            patch: { video: { transform: { scale: 0.5 }, layoutPreset: "pipRight" } },
          },
        },
        {
          setKeyframes: {
            clipID: "c",
            parameter: "video.transform.scale",
            keyframes: [
              { time: 0, value: 0.5 },
              { time: 1, value: 0.6 },
            ],
          },
        },
        {
          setKeyframes: {
            clipID: "s",
            parameter: "video.transform.position",
            keyframes: [{ time: 0, value: { x: 0.4, y: 0.5 } }],
          },
        },
      ],
    });
    const plan = planShort(c.getSnapshot());
    expect(plan.placed).toEqual({ top: 1, bottom: 1 });
    c.apply({ label: plan.label, commands: plan.commands });
    const laid = c.getSnapshot().project;
    const camera = laid.videoTracks[0]!.clips.find((x) => x.id === "c")!;
    const bottom = fillingTransform("bottom", 1920, 1080, 1080, 1920);
    expect(camera.video?.formatOverrides).toMatchObject({
      portrait: { transform: bottom, cutout: false },
    });
    expect(clipInFormat(camera, "portrait")!.keyframes["video.transform.scale"]).toBeUndefined();
    const adopted = c.apply({ commands: [{ adoptFormat: { format: "portrait" } }] });
    const p = c.getSnapshot().project;
    expect([p.settings.width, p.settings.height, p.settings.alternateFormats]).toEqual([
      1080,
      1920,
      [],
    ]);
    const after = p.videoTracks[0]!.clips.find((x) => x.id === "c")!;
    expect(after.video?.transform).toEqual(bottom);
    expect(after.video?.formatOverrides).toEqual({});
    expect(after.keyframes["video.transform.scale"]!.map((k) => k.value)).toEqual([
      bottom.scale,
      (bottom.scale * 0.6) / 0.5,
    ]);
    expect(p.videoTracks[0]!.clips.find((x) => x.id === "s")!.keyframes).toEqual({});
    expect(adopted.warnings.join(" ")).toMatch(/Dropped the zoom on s/);
  });
  it("hides clips per format and refuses an already portrait canvas", () => {
    const c = session();
    c.apply({
      commands: [
        {
          updateSettings: {
            patch: {
              alternateFormats: [{ id: "portrait", name: "Short", width: 1080, height: 1920 }],
            },
          },
        },
        {
          updateClip: {
            clipID: "c",
            patch: { video: { formatOverrides: { portrait: { hidden: true } } } },
          },
        },
      ],
    });
    const camera = c.getSnapshot().project.videoTracks[0]!.clips[0]!;
    expect(clipInFormat(camera, "portrait")).toBeNull();
    c.apply({ commands: [{ adoptFormat: { format: "portrait" } }] });
    expect(c.getSnapshot().project.videoTracks[0]!.clips[0]!.enabled).toBe(false);
    expect(() => planShort(c.getSnapshot())).toThrow(/already 9:16/);
  });
});
