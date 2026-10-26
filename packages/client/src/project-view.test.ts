import { expect, it, expectTypeOf } from "vite-plus/test";
import { ProjectView, cmd, fixCaptionWords, type Command, type ServiceRequest } from "./index";

const project = () =>
  new ProjectView(
    {
      id: "sdk",
      media: [{ id: "voice", path: "media/voice.wav", kind: "audio", role: "camera" }],
      videoTracks: [
        {
          id: "bottom",
          name: "Picture",
          kind: "video",
          clips: [
            {
              id: "bottom-clip",
              start: 2,
              duration: 5,
              content: { solid: { color: { r: 0, g: 0, b: 0, a: 1 } } },
            },
          ],
        },
        {
          id: "top",
          name: "Captions",
          kind: "video",
          clips: [
            {
              id: "caption",
              start: 0,
              duration: 6,
              content: {
                text: {
                  text: '"Comics, news models!"',
                  words: [
                    { text: '"Comics,', start: 0, end: 1 },
                    { text: "news", start: 1, end: 2 },
                    { text: 'models!"', start: 2, end: 3 },
                  ],
                },
              },
            },
          ],
          transitions: [{ id: "push", type: "push", duration: 0.2, fromClipID: "caption" }],
        },
      ],
    },
    7,
  );

it("derives command builders from JSON command inputs rather than decoded time objects", () => {
  const command = cmd.blade({ at: 1.25 });
  expectTypeOf(command).toExtend<Command>();
  expectTypeOf<ServiceRequest<"assets-search">["limit"]>().toEqualTypeOf<number | undefined>();
  expectTypeOf<ServiceRequest<"assets-search">["kind"]>().toEqualTypeOf<
    string | string[] | undefined
  >();
  expectTypeOf<ServiceRequest<"insert-segment">["values"]>().toEqualTypeOf<
    Record<string, string> | undefined
  >();
  expectTypeOf<ServiceRequest<"frame">>().toExtend<{ time: number | string }>();
  expect(command).toEqual({ blade: { at: 1.25 } });
  expect(
    cmd.insertClip({ trackID: "top", clip: { duration: 2, content: { text: { text: "Hello" } } } }),
  ).toMatchObject({ insertClip: { clip: { duration: 2 } } });
  // @ts-expect-error Command field names are authoritative and case-sensitive.
  cmd.updateClip({ clipId: "caption", patch: {} });
});

it("normalizes project JSON and locates tracks, chronological clips, stacking, transitions and media", () => {
  const view = project();
  expect(view.json.settings.frameRate.numerator).toBe(30);
  expect(view.revision).toBe(7);
  expect(view.track("Picture").id).toBe("bottom");
  expect(view.track("top").name).toBe("Captions");
  expect(view.clips().map((clip) => clip.id)).toEqual(["caption", "bottom-clip"]);
  expect(view.clip("bottom-clip").end).toBe(7);
  expect(view.at(3).map((clip) => clip.id)).toEqual(["caption", "bottom-clip"]);
  expect(view.at(7)).toEqual([]);
  expect(view.transitions((item) => item.type === "push")[0]?.id).toBe("push");
  expect(view.captions()[0]?.text).toBe('"Comics, news models!"');
  expect(view.media("voice.wav").id).toBe("voice");
  expect(view.media("camera").id).toBe("voice");
  expect(() => view.media("ice.wav")).toThrow("No media");
  expect(() => view.track("missing")).toThrow("Tracks: Picture, Captions");
  expect(() => view.clip("missing")).toThrow("No clip");
  expect(() => view.at(NaN)).toThrow();
  expect(
    () => new ProjectView({ videoTracks: [{ kind: "video", clips: [{ duration: "bad" }] }] }, 0),
  ).toThrow();
});

it("plans timed and untimed caption replacements without changing project data", () => {
  const view = project(),
    before = JSON.stringify(view.json);
  const result = fixCaptionWords(view, { comics: "Convex", "news models": "Muse models" });
  expect(result.changes).toEqual([
    { clipID: "caption", before: '"Comics, news models!"', after: '"Convex, Muse models!"' },
  ]);
  expect(result.commands).toMatchObject([
    {
      updateClip: {
        clipID: "caption",
        patch: {
          name: '"Convex, Muse models!"',
          content: {
            text: {
              text: '"Convex, Muse models!"',
              words: [
                { text: '"Convex,', start: 0, end: 1 },
                { text: 'Muse models!"', start: 1, end: 3 },
              ],
            },
          },
        },
      },
    },
  ]);
  expect(JSON.stringify(view.json)).toBe(before);
  expect(fixCaptionWords(view, { missing: "Nothing" }).commands).toEqual([]);
  expect(() => fixCaptionWords(view, { "": "bad" })).toThrow("nonempty");
  const untimed = new ProjectView(
    {
      videoTracks: [
        {
          id: "v",
          kind: "video",
          name: "Captions",
          clips: [{ id: "text", duration: 1, content: { text: { text: "comics" } } }],
        },
      ],
    },
    0,
  );
  expect(fixCaptionWords(untimed, { comics: "Convex" }).commands).toMatchObject([
    { updateClip: { patch: { content: { text: { text: "Convex" } } } } },
  ]);
});
