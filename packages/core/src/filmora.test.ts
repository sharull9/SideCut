import { describe, expect, it } from "vite-plus/test";
import { strToU8, strFromU8, zipSync } from "fflate";
import { importFilmora } from "./interchange";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { framePlan } from "./render-plan";
import { keyframeValue } from "./keyframes";
import { mapFilmoraTransition } from "./filmora-transitions";

const userdata = (key: number, value: string | number[]) => {
  const bytes = typeof value === "string" ? strToU8(value) : Uint8Array.from(value);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let data = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const v = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    data +=
      alphabet[(v >> 18) & 63]! +
      alphabet[(v >> 12) & 63]! +
      (i + 1 < bytes.length ? alphabet[(v >> 6) & 63]! : "=") +
      (i + 2 < bytes.length ? alphabet[v & 63]! : "=");
  }
  return { key, data };
};
const effect = (
  id: string,
  params: Record<string, unknown>,
  extras: Record<string, unknown> = {},
) => ({
  id,
  paramList: Object.entries(params).map(([name, unValue]) => ({ name, fxParam: { unValue } })),
  ...extras,
});
const chain = (...effects: unknown[]) => [{ effectList: effects }];
const clip = (extra: Record<string, unknown> = {}) => ({
  type: 1,
  sourceUuid: "camera",
  filename: "file:///fixture/take-camera.mov",
  tlBegin: 0,
  tlEnd: 19999999,
  inPoint: 10000000,
  ...extra,
});
const track = (clips: unknown[], extra: Record<string, unknown> = {}) => ({
  trackType: 1,
  clipList: clips,
  ...extra,
});
function folder(tracks: unknown[], extra: Record<string, unknown> = {}) {
  return {
    "project_info.json": strToU8(
      JSON.stringify({
        timeline_mediaId: "main",
        project_file_name: "Mapping fixture",
        project_timeline_resolution: [1920, 1080],
        project_timeline_framerate: [30, 1],
      }),
    ),
    "Medias/main/timeline.wesproj": strToU8(
      JSON.stringify({
        currentTimelineId: 1,
        timelineInfos: [
          { timelineId: 1, userData: [userdata(3, "main-map\0")], trackInfos: tracks },
        ],
        resources: [
          {
            sourceUuid: "camera",
            filename: "file:///fixture/take-camera.mov",
            mediaLength: 200000000,
            videoStreamCount: 1,
            audioStreamCount: 1,
            vidStreamInfo: [{ width: 1920, height: 1080 }],
          },
        ],
      }),
    ),
    ...(Object.keys(extra).length
      ? { "Medias/main/extra.json": strToU8(JSON.stringify(extra)) }
      : {}),
  };
}
const imported = (clips: unknown[], keepLevels = false) =>
  importFilmora(folder([track(clips)]), { keepLevels });

describe("Filmora 118.03: folders and markers", () => {
  it.each(["", "ProjectFolder/", "项目.wfp.dir/ProjectFolder/"])(
    "reads the folder layout %s and timeline markers",
    (prefix) => {
      const entries = Object.fromEntries(
        Object.entries(
          folder([track([clip()])], {
            allMarkersInfo: {
              "main-map": [
                { position: 12500000, name: "Chapter", comments: "Review this" },
                { position: 0, name: "" },
              ],
              other: [{ position: 0 }],
              beatDetectInfo: {},
            },
          }),
        ).map(([path, bytes]) => [prefix + path, bytes]),
      );
      const { file, report } = importFilmora(entries);
      expect(file.project.markers).toMatchObject([
        { time: 0, name: "Marker" },
        { time: 1.25, name: "Chapter", note: "Review this" },
      ]);
      expect(report.warnings.join(" ")).toMatch(/1 marker.*weren't imported/);
      expect(decodeProjectFile(JSON.parse(encodeProjectFile(file))).project.markers).toEqual(
        file.project.markers,
      );
    },
  );
  it("has equivalent zip/folder results and rejects ambiguous, malformed and unsafe metadata", () => {
    const entries = folder([track([clip()])]);
    const zipped = Object.fromEntries(
      Object.entries(entries).map(([name, bytes]) => [`ProjectFolder/${name}`, bytes]),
    );
    expect(importFilmora(zipSync(zipped)).file.project.videoTracks).toEqual(
      importFilmora(entries).file.project.videoTracks,
    );
    expect(() =>
      importFilmora({ ...entries, "another/project_info.json": entries["project_info.json"] }),
    ).toThrow(/one Filmora/);
    expect(() => importFilmora({ ...entries, "../escape": strToU8("x") })).toThrow(/Unsafe/);
    expect(() =>
      importFilmora({ ...entries, "Medias/main/extra.json": strToU8("broken") }),
    ).toThrow();
    expect(() =>
      importFilmora({ "project_info.json": strToU8('{"timeline_mediaId":"../outside"}') }),
    ).toThrow(/Unsafe/);
    expect(() =>
      importFilmora(folder([], { allMarkersInfo: { "main-map": [{ position: -1 }] } })),
    ).toThrow();
  });
});

describe("Filmora 118.04: source classification, lanes and links", () => {
  it("keeps shared video/audio capabilities, names and transitive recording/map links", () => {
    const { file } = importFilmora(
      folder([
        track([clip({ userData: [userdata(3, "pair"), userdata(50, "Face camera\0")] })], {
          mute: true,
          locked: true,
        }),
        track([
          clip({ type: 14, sourceUuid: "screen", filename: "file:///fixture/take-screen.mov" }),
        ]),
        track([clip({ type: 2, userData: [userdata(3, "pair")] })], {
          trackType: 2,
          userData: [userdata(20, [0, 0, 0, 0])],
        }),
      ]),
    );
    expect(file.project.media[0]).toMatchObject({
      kind: "video",
      role: "camera",
      hasVideo: true,
      hasAudio: true,
      width: 1920,
      height: 1080,
    });
    expect(file.project.videoTracks.map((t) => t.name)).toEqual(["Camera", "Screen"]);
    expect(file.project.audioTracks[0]).toMatchObject({ name: "Voice", rippleMode: "cut" });
    expect(file.project.videoTracks[0]).toMatchObject({ hidden: true, muted: false, locked: true });
    const clips = [...file.project.videoTracks, ...file.project.audioTracks].flatMap(
      (t) => t.clips,
    );
    expect(clips[0]!.name).toBe("Face camera");
    expect(new Set(clips.map((c) => c.linkGroup)).size).toBe(1);
    expect(clips[0]!.linkGroup).toBeTruthy();
  });
  it("splits overlaps, closes tiny gaps, preserves order and avoids linking different ranges", () => {
    const { file, report } = imported([
      clip(),
      clip({ tlBegin: 10000000, tlEnd: 14999999 }),
      clip({ tlBegin: 20005000, tlEnd: 29999999 }),
    ]);
    expect(file.project.videoTracks.map((t) => t.name)).toEqual(["Camera", "Camera extra"]);
    expect(file.project.videoTracks[0]!.clips[0]!.duration.seconds).toBe(2.0005);
    expect(file.project.videoTracks[0]!.clips[1]!.linkGroup).toBeUndefined();
    expect(report.warnings.join(" ")).toMatch(/Overlapping/);
    const coordinator = new ProjectCoordinator(file);
    const id = file.project.videoTracks[0]!.clips[0]!.id;
    coordinator.apply({ commands: [{ updateClip: { clipID: id, patch: { name: "Edited" } } }] });
    coordinator.undo();
    expect(coordinator.projectFile().project.videoTracks).toEqual(file.project.videoTracks);
  });
  it("classifies library resources and rejects corrupt map IDs and unsafe ticks", () => {
    const { file } = imported([
      clip({ userData: [userdata(12, JSON.stringify({ res_type: 55 }))] }),
    ]);
    expect(file.project.media[0]!.role).toBe("broll");
    expect(file.project.videoTracks[0]!.name).toBe("B-roll");
    expect(() => imported([clip({ userData: [{ key: 3, data: "bad!!" }] })])).toThrow(/base64/);
    expect(() => imported([clip({ tlEnd: Number.MAX_SAFE_INTEGER + 1 })])).toThrow(/tick/);
  });
});

describe("Filmora 118.05: picture and animation", () => {
  it("maps transform, crop, opacity, cutout and source-time keyframes through speed", () => {
    const key = (name: string, values: number[][]) => ({
      name,
      keyFrame: {
        parameter: JSON.stringify({
          keyframeSets: values.map(([_time, _value]) => ({ _time, _value })),
        }),
      },
    });
    const { file, report } = imported([
      clip({
        speed: 2,
        humanseg_hair: { status: 1 },
        pipBuf: JSON.stringify({
          Opacity: 70,
          BlendMode: "multiply",
          OpacityKeyFrame: JSON.stringify({
            keyframeSets: [
              { _time: 10000000, _value: 100 },
              { _time: 50000000, _value: 0 },
            ],
          }),
        }),
        effectChainList: chain(
          effect(
            "video/effect/transform",
            { Scale_x: 50, Scale_y: 60, Position_x: 0.8, Position_y: 0.7, Rotation: 20 },
            {
              paramMapList: [
                key("Position_x", [
                  [1, 0.2],
                  [5, 0.8],
                ]),
                key("Scale_x", [
                  [1, 100],
                  [5, 200],
                ]),
              ],
            },
          ),
          effect("video/effect/crop-pan-zoom", {
            crop_x: 0.1,
            crop_y: 0.2,
            crop_width: 0.8,
            crop_height: 0.6,
          }),
        ),
      }),
    ]);
    const c = file.project.videoTracks[0]!.clips[0]!;
    expect(c.video).toMatchObject({
      transform: { position: { x: 0.8, y: 0.7 }, scale: 0.5, rotation: 20 },
      opacity: 0.7,
      crop: { left: 0.1, top: 0.2 },
      cutout: { enabled: true },
      layoutPreset: "pipRight",
    });
    expect(c.keyframes["video.transform.scale"]!.map((k) => [k.time, k.value])).toEqual([
      [0, 1],
      [2, 2],
    ]);
    expect(keyframeValue(c.keyframes["video.transform.position"]!, 1)).toEqual({ x: 0.5, y: 0.7 });
    expect(keyframeValue(c.keyframes["video.opacity"]!, 1)).toBe(0.5);
    expect(report.warnings.join(" ")).toMatch(/stretched.*Blend mode/);
  });
  it("retains nearest keys outside a trimmed clip and maps still-image animation clocks", () => {
    const e = effect(
      "video/effect/transform",
      {},
      {
        paramMapList: [
          {
            name: "Rotation",
            keyFrame: {
              parameter: {
                keyframeSets: [-20, -10, 0, 1, 2, 3, 20].map((_time) => ({
                  _time,
                  _value: _time * 5,
                })),
              },
            },
          },
        ],
      },
    );
    const { file } = imported([clip({ effectChainList: chain(e) })]);
    expect(
      file.project.videoTracks[0]!.clips[0]!.keyframes["video.transform.rotation"]!.map(
        (k) => k.time,
      ),
    ).toEqual([-1, 0, 1, 2, 19]);
    const entries = folder([
      track([
        clip({
          sourceUuid: "still",
          filename: "file:///fixture/photo.png",
          inPoint: 36000000000,
          effectChainList: chain(
            effect(
              "video/effect/transform",
              {},
              {
                paramMapList: [
                  {
                    name: "Scale_x",
                    keyFrame: {
                      parameter: {
                        keyframeSets: [
                          { _time: 3600, _value: 100 },
                          { _time: 3602, _value: 200 },
                        ],
                      },
                    },
                  },
                ],
              },
            ),
          ),
        }),
      ]),
    ]);
    const doc = JSON.parse(strFromU8(entries["Medias/main/timeline.wesproj"]));
    doc.resources.push({
      sourceUuid: "still",
      filename: "file:///fixture/photo.png",
      streamType: 5,
    });
    entries["Medias/main/timeline.wesproj"] = strToU8(JSON.stringify(doc));
    const still = importFilmora(entries).file.project.videoTracks[0]!.clips[0]!;
    expect(still.sourceStart.seconds).toBe(0);
    expect(still.keyframes["video.transform.scale"]!.map((k) => k.time)).toEqual([0, 2]);
  });
  it("maps pan/zoom and leaves disabled settings alone; rejects invalid crops", () => {
    const { file } = imported([
      clip({
        effectChainList: chain(
          effect("video/effect/transform", { Scale_x: 999 }, { enable: false }),
          effect("video/effect/crop-pan-zoom", {
            SettingScript: JSON.stringify([
              { Time: 0, X: 0, Y: 0, Width: 1, Height: 1 },
              { Time: 1, X: 0.25, Y: 0.25, Width: 0.5, Height: 0.5 },
            ]),
          }),
        ),
      }),
    ]);
    expect(
      file.project.videoTracks[0]!.clips[0]!.keyframes["video.transform.scale"]!.map(
        (k) => k.value,
      ),
    ).toEqual([1, 2]);
    expect(() =>
      imported([
        clip({
          effectChainList: chain(
            effect("video/effect/crop-pan-zoom", {
              crop_x: 0,
              crop_y: 0,
              crop_width: -1,
              crop_height: 1,
            }),
          ),
        }),
      ]),
    ).toThrow(/crop/);
    expect(() => imported([clip({ pipBuf: "malformed" })])).toThrow();
  });
});

describe("Filmora 118.06: colour and shared looks", () => {
  const grade = (amount = 10) =>
    effect("662E16ED-4524-4D13-AAE9-11DBA0C63E17", {
      u_contrast: amount,
      u_exposure: 25,
      u_brightness: 25,
      Red_satVal: 12,
      amount: -20,
      size: 40,
      lut3dPath: "looks/film.cube",
      alpha: 50,
      unsupportedColour: 1,
    });
  it("promotes identical grades to source looks, retaining border and shadow on clips", () => {
    const effects = chain(
      grade(),
      effect("video/effect/transform", { EnableShadow: 1, nDistance: 5 }),
      effect("border", { Size: 3, Color: 0xff8000 }, { display: "PipBorder" }),
    );
    const { file, report } = imported([
      clip({ effectChainList: effects }),
      clip({ tlBegin: 20000000, tlEnd: 39999999, effectChainList: effects }),
    ]);
    expect(file.project.media[0]!.look.map((e) => e.type)).toEqual([
      "colorAdjust",
      "hsl",
      "vignette",
      "lut",
    ]);
    expect(file.project.media[0]!.look[0]).toMatchObject({ params: { contrast: 10, exposure: 1 } });
    const c = file.project.videoTracks[0]!.clips[0]!;
    expect(c.video?.effects).toMatchObject([
      { type: "dropShadow", params: { distance: 5 } },
      { type: "border", params: { width: 3, color: { r: 1, b: 0 } } },
    ]);
    expect(report.warnings.join(" ")).toMatch(/no Tandem equivalent/);
    expect(new Set(file.project.media[0]!.look.map((e) => e.id)).size).toBe(4);
    expect(framePlan(file.project, 1).layers[0]).toBeTruthy();
  });
  it("keeps differing or partially absent grades on clips and reports unsupported effects", () => {
    const { file, report } = imported([
      clip({
        effectChainList: chain(grade(), effect("flip", { power: 2 }, { display: "Unknown" })),
      }),
      clip({ tlBegin: 20000000, tlEnd: 39999999 }),
    ]);
    expect(file.project.media[0]!.look).toEqual([]);
    expect(file.project.videoTracks[0]!.clips[0]!.video?.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "colorAdjust" })]),
    );
    expect(file.project.videoTracks[0]!.clips[1]!.video?.effects).toEqual([]);
    expect(report.warnings.join(" ")).toMatch(/Unknown isn't supported/);
    expect(() =>
      imported([clip({ effectChainList: chain(effect("bad", {}, { paramList: "bad" })) })]),
    ).toThrow();
  });
});

describe("Filmora 118.07: sound", () => {
  const audioClip = (extra: Record<string, unknown> = {}) => clip({ type: 2, ...extra });
  it("preserves Filmora gains/normalization when requested, clamps fades and imports denoise", () => {
    const effects = chain(
      effect("audio/effect/volume", {
        VolumeGain: -3,
        LoudnessGainEnable: true,
        LoudnessGain: 2,
        Balance: 0.8,
      }),
      effect("audio/effect/fade", { FadeInTime: 5, FadeOutTime: 0.4 }),
    );
    const { file, report } = importFilmora(
      folder([
        track(
          [audioClip({ enableV3Denoise: true, denoiseV3Strength: 80, effectChainList: effects })],
          { trackType: 2 },
        ),
      ]),
      { keepLevels: true },
    );
    expect(file.project.audioTracks[0]!.clips[0]!.audio).toMatchObject({
      gainDB: -1,
      normalizeTo: -24,
      fadeIn: 2,
      fadeOut: 0.4,
      voiceIsolation: 0.8,
    });
    expect(report.warnings.join(" ")).toMatch(/Pan.*Fades.*denoise/);
  });
  it("normalizes speech by default and keeps music and SFX at their imported levels", () => {
    const volume = chain(
      effect("audio/effect/volume", { VolumeGain: -7, LoudnessGainEnable: true, LoudnessGain: 1 }),
    );
    const music = audioClip({
      sourceUuid: "music",
      filename: "file:///fixture/music/song.wav",
      userData: [userdata(12, '{"res_type":46}')],
      effectChainList: volume,
    });
    const { file, report } = importFilmora(
      folder([
        track([audioClip({ effectChainList: volume })], { trackType: 2, locked: true }),
        track([music], { trackType: 2 }),
      ]),
    );
    expect(file.project.audioTracks[0]!.clips[0]!.audio).toMatchObject({
      gainDB: 0,
      normalizeTo: -20,
    });
    expect(file.project.audioTracks[1]!.clips[0]!.audio).toMatchObject({
      gainDB: -6,
      normalizeTo: -24,
    });
    expect(report.warnings.join(" ")).toMatch(/Speech was normalised/);
    expect(file.project.audioTracks[0]!.locked).toBe(true);
  });
  it("normalizes all clips on a speech track, including screen sound and mixed music", () => {
    const { file } = importFilmora(
      folder([
        track(
          [
            audioClip({
              type: 15,
              sourceUuid: "screen",
              filename: "file:///fixture/take-screen.mov",
            }),
            audioClip({
              sourceUuid: "music",
              filename: "file:///fixture/music/song.wav",
              userData: [userdata(12, '{"res_type":46}')],
            }),
          ],
          { trackType: 2 },
        ),
      ]),
    );
    expect(file.project.audioTracks.every((t) => t.rippleMode === "cut")).toBe(true);
    expect(
      file.project.audioTracks.flatMap((t) => t.clips).every((c) => c.audio?.normalizeTo === -20),
    ).toBe(true);
  });
  it("ignores disabled audio effects, reports unsupported automation and rejects negative fades", () => {
    const { file, report } = importFilmora(
      folder([
        track(
          [
            audioClip({
              effectChainList: chain(
                effect("audio/effect/volume", { VolumeGain: 20 }, { enable: false }),
                effect("audio/effect/ducking", {}, { enable: true }),
              ),
              volumeKeyframe: {
                parameter: {
                  keyframeSets: [
                    { _time: 0, _value: 0 },
                    { _time: 2, _value: 1 },
                  ],
                },
              },
            }),
          ],
          { trackType: 2 },
        ),
      ]),
      { keepLevels: true },
    );
    expect(file.project.audioTracks[0]!.clips[0]!.audio?.gainDB).toBe(0);
    expect(report.warnings.join(" ")).toMatch(/ducking.*Volume keyframes/);
    expect(() =>
      importFilmora(
        folder([
          track(
            [
              audioClip({
                effectChainList: chain(effect("audio/effect/fade", { FadeInTime: -1 })),
              }),
            ],
            { trackType: 2 },
          ),
        ]),
      ),
    ).toThrow(/negative/);
  });
});

describe("Filmora 118.08: transitions", () => {
  it.each([
    ["Cut Slide Transition 03", "cutSlide", undefined, true],
    ["Push Down", "push", "down", true],
    ["Dissolve", "dissolve", undefined, true],
    ["fade_black", "fadeToBlack", undefined, true],
    ["Wipe Left", "wipe", "left", true],
    ["Slide Up", "slide", "up", true],
    ["Zoom", "zoom", undefined, false],
    ["Unknown", "dissolve", undefined, false],
  ])("maps %s and its exactness", (name, type, direction, exact) => {
    expect(mapFilmoraTransition(String(name), false, "between")).toMatchObject({
      type,
      exact,
      ...(direction ? { direction } : {}),
    });
  });
  it("joins a cut once, centers off-center transitions and maps head/tail fades", () => {
    const cut = { display: "Push Left", tlBegin: 17000000, tlEnd: 20999999 };
    const { file, report } = imported([
      clip({
        preTransition: { display: "fade_black", tlBegin: 0, tlEnd: 2999999 },
        postTransition: cut,
      }),
      clip({
        tlBegin: 20000000,
        tlEnd: 39999999,
        inPoint: 30000000,
        preTransition: cut,
        postTransition: { display: "Unknown", tlBegin: 37000000, tlEnd: 39999999 },
      }),
    ]);
    const transitions = file.project.videoTracks[0]!.transitions;
    expect(transitions.map((t) => t.type)).toEqual(["push", "fadeFromBlack", "dissolve"]);
    expect(transitions.filter((t) => t.fromClipID && t.toClipID)).toHaveLength(1);
    expect(report.warnings.join(" ")).toMatch(/off-centre.*Unknown/);
    expect(
      new ProjectCoordinator(decodeProjectFile(JSON.parse(encodeProjectFile(file)))).getSnapshot()
        .revision,
    ).toBe(1);
  });
  it("shortens to source handles, drops impossible cuts and clamps end durations", () => {
    const edge = { display: "Dissolve", tlBegin: 15000000, tlEnd: 24999999 };
    const { file, report } = imported([
      clip({ postTransition: edge }),
      clip({ tlBegin: 20000000, tlEnd: 39999999, inPoint: 1000000 }),
    ]);
    expect(Number(file.project.videoTracks[0]!.transitions[0]!.duration)).toBeCloseTo(0.2);
    expect(report.warnings.join(" ")).toMatch(/shortened/);
    const absent = imported([
      clip({ postTransition: edge }),
      clip({ tlBegin: 20000000, tlEnd: 39999999, inPoint: 0 }),
    ]);
    expect(absent.file.project.videoTracks[0]!.transitions).toEqual([]);
    expect(absent.report.warnings.join(" ")).toMatch(/no media beyond/);
    const head = imported([
      clip({ preTransition: { display: "Dissolve", tlBegin: 0, tlEnd: 99999999 } }),
    ]);
    expect(head.file.project.videoTracks[0]!.transitions[0]!.duration).toBe(2);
    expect(() =>
      imported([clip({ preTransition: { tlBegin: 0, tlEnd: Number.MAX_SAFE_INTEGER } })]),
    ).toThrow(/ticks/);
  });
  it("maps audio fades as crossfades and preserves unknown-name warnings", () => {
    expect(mapFilmoraTransition("Constant Gain", true, "between")).toEqual({
      type: "dissolve",
      exact: true,
    });
    const { file, report } = importFilmora(
      folder([
        track(
          [clip({ type: 2, preTransition: { display: "Push Left", tlBegin: 0, tlEnd: 4999999 } })],
          { trackType: 2 },
        ),
      ]),
    );
    expect(file.project.audioTracks[0]!.transitions[0]!.type).toBe("dissolve");
    expect(report.warnings.join(" ")).toMatch(/crossfade/);
  });
});

describe("Filmora 118.09: titles and nested templates", () => {
  const title = (extra: Record<string, unknown> = {}) =>
    clip({
      type: 4,
      scriptBuf: JSON.stringify({
        Text: "Hello\r\nworld",
        ScaleY: 0.2,
        PosX: 0.7,
        PosY: 0.6,
        Layout: { TextAlign: "left", Angle: 15 },
        TextData: [
          {
            Basic: {
              FontName: "Example SemiBold",
              TextColor: [{ Color: 0xff8000 }],
              TextAlpha: 128,
            },
            Border: { Enable: true, Size: 2, Color: 0 },
            Shadow: { Enable: true },
          },
        ],
      }),
      inAnimation: { name: "Typewriter", duration: 3000000 },
      outAnimation: { name: "Fade", duration: 5000000 },
      ...extra,
    });
  const nested = (tracks: unknown[], children: unknown[]) => {
    const entries = folder(tracks);
    const doc = JSON.parse(strFromU8(entries["Medias/main/timeline.wesproj"]));
    doc.timelineInfos.push({ timelineId: 2, trackInfos: children });
    entries["Medias/main/timeline.wesproj"] = strToU8(JSON.stringify(doc));
    return entries;
  };
  it("imports text, estimated sizing, font weight, colors, position and animations", () => {
    const { file } = imported([title()]);
    const c = file.project.videoTracks[0]!.clips[0]!;
    expect(file.project.videoTracks[0]!.name).toBe("Text");
    expect(c.content.text).toMatchObject({
      text: "Hello\nworld",
      style: {
        font: "Example SemiBold",
        weight: 600,
        size: 77,
        alignment: "left",
        strokeWidth: 2,
        shadow: true,
        color: { r: 1, b: 0 },
      },
      animationIn: "typewriter",
      animationOut: "fadeOut",
      animationDuration: 0.3,
    });
    expect(c.video).toMatchObject({ transform: { position: { x: 0.7, y: 0.6 }, rotation: 15 } });
  });
  it("clamps nested media/title clocks, maps parent transforms and includes sounds once", () => {
    const parent = clip({
      type: 6,
      timelineId: 2,
      tlBegin: 50000000,
      tlEnd: 69999999,
      inPoint: 10000000,
      userData: [userdata(50, "Demo template")],
      effectChainList: chain(
        effect("video/effect/transform", { Position_x: 0.8, Position_y: 0.7, Scale_x: 50 }),
      ),
    });
    const sound = clip({ type: 2, tlBegin: 0, tlEnd: 39999999 });
    const entries = nested(
      [track([parent]), track([{ ...parent, type: 16 }], { trackType: 2 })],
      [
        track([
          title({ tlBegin: 0, tlEnd: 39999999 }),
          clip({ tlBegin: 0, tlEnd: 39999999, speed: 2 }),
        ]),
        track([sound], { trackType: 2 }),
      ],
    );
    const { file, report } = importFilmora(entries);
    const pictures = file.project.videoTracks.flatMap((t) => t.clips);
    expect(pictures).toHaveLength(2);
    expect(pictures.map((c) => [c.start.seconds, c.duration.seconds])).toEqual([
      [5, 2],
      [5, 2],
    ]);
    expect(pictures.find((c) => c.content.media)!.sourceStart.seconds).toBe(3);
    expect(pictures.find((c) => c.content.text)!.video).toMatchObject({
      transform: { position: { x: 0.9, y: 0.75 } },
    });
    expect(file.project.audioTracks).toHaveLength(1);
    expect(file.project.audioTracks[0]!.name).toBe("Template sounds");
    expect(file.project.audioTracks[0]!.clips).toHaveLength(1);
    expect(pictures.every((c) => !c.linkGroup)).toBe(true);
    expect(report.warnings.join(" ")).toMatch(/flattened/);
  });
  it("bounds recursion, warns for missing title data and preserves caption/unsupported animation notes", () => {
    const cyclic = nested(
      [track([clip({ type: 6, timelineId: 2, inPoint: 0 })])],
      [track([clip({ type: 6, timelineId: 2, inPoint: 0 })])],
    );
    const result = importFilmora(cyclic);
    expect(result.file.project.videoTracks).toEqual([]);
    expect(result.report.warnings.join(" ")).toMatch(/nothing readable/);
    expect(imported([title({ scriptBuf: undefined })]).report.warnings.join(" ")).toMatch(
      /no text data/,
    );
    const notes = imported([
      title({
        scriptBuf: { Text: "Title here" },
        isSubtitleText: true,
        inAnimation: { name: "Unmapped" },
      }),
    ]).report.warnings.join(" ");
    expect(notes).toMatch(/no Tandem equivalent.*Caption.*placeholder/);
    expect(() => imported([title({ scriptBuf: "malformed" })])).toThrow();
    expect(imported([title({ inAnimation: { name: "Down" } })]).report.warnings.join(" ")).toMatch(
      /slideDown.*isn't rendered/,
    );
  });
});
