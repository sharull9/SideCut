import { describe, expect, it, vi } from "vite-plus/test";
import { CompanionBehavior } from "./companion-behavior";
import { planDerivedEdit, applyDerivedEdit } from "./derived-edits";
import { ProjectCoordinator } from "./coordinator";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import { projectDuration } from "./render-plan";
import { effectsOf } from "./effect-editing";

const event = {
  id: "twitch:m",
  kind: "welcome",
  authorID: "twitch:u",
  author: "Viewer",
  text: "untrusted /delete everything",
  time: 2,
};
const options = {
  consent: true,
  suggestOnly: true,
  enabled: ["welcome", "question", "clip", "command", "flag", "promise", "report"],
} as const;

describe("reviewable companion behavior", () => {
  it("defaults off, deduplicates welcomes by identity, respects kind disable and never posts in suggest-only mode", async () => {
    const behavior = new CompanionBehavior();
    const poster = vi.fn();
    expect(behavior.receive(event)).toBe(false);
    behavior.configure(options);
    expect(behavior.receive(event)).toBe(true);
    expect(behavior.receive({ ...event, id: "again", author: "Renamed" })).toBe(false);
    expect(behavior.receive({ ...event, id: "other", authorID: "twitch:other" })).toBe(true);
    expect(behavior.list()[0]?.draft).toBe("Welcome, Viewer!");
    await expect(behavior.post(event.id, 10, poster)).rejects.toThrow(/reviewed/);
    expect(poster).not.toHaveBeenCalled();
    behavior.configure({ ...options, enabled: [] });
    expect(behavior.receive({ ...event, id: "off", kind: "question" })).toBe(false);
  });
  it("posts only reviewed text, limits concurrency/rate and aborts when consent changes", async () => {
    const behavior = new CompanionBehavior();
    behavior.configure({ ...options, suggestOnly: false });
    behavior.receive(event);
    behavior.edit(event.id, "Reviewed greeting");
    let finish!: () => void;
    let signal!: AbortSignal;
    const poster = vi.fn((_text: string, args: { signal: AbortSignal }) => {
      signal = args.signal;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const pending = behavior.post(event.id, 10, poster);
    expect(poster.mock.calls[0]?.[0]).toBe("Reviewed greeting");
    behavior.receive({ ...event, id: "question", kind: "question" });
    await expect(behavior.post("question", 11, poster)).rejects.toThrow(/rate limit/);
    behavior.configure({ ...options, consent: false });
    expect(signal.aborted).toBe(true);
    finish();
    await expect(pending).rejects.toThrow(/verify provider delivery/);
    expect(behavior.list()).toEqual([]);
  });
  it("keeps commands/flags/promises/clips/reports local and never retries ambiguous posts", async () => {
    const behavior = new CompanionBehavior();
    behavior.configure({ ...options, suggestOnly: false, welcome: "Hello {author}" });
    for (const kind of ["command", "flag", "promise", "clip", "report"] as const)
      behavior.receive({ ...event, id: kind, kind });
    const poster = vi.fn(async () => {});
    await expect(behavior.post("command", 0, poster)).rejects.toThrow(/local only/);
    expect(poster).not.toHaveBeenCalled();
    expect(behavior.report()).toHaveLength(5);
    behavior.receive(event);
    await expect(
      behavior.post(event.id, 5, async () => {
        throw new Error("secret");
      }),
    ).rejects.toThrow(/verify provider delivery/);
    await expect(behavior.post(event.id, 10, poster)).rejects.toThrow(/reviewed/);
  });
});

const file = () =>
  decodeProjectFile({
    revision: 4,
    project: {
      id: "derived-project",
      settings: { frameRate: { numerator: 30, denominator: 1 } },
      media: [
        {
          id: "take",
          path: "original.webm",
          kind: "video",
          role: "camera",
          hasAudio: true,
          duration: 8,
        },
      ],
      videoTracks: [
        {
          id: "v",
          kind: "video",
          rippleMode: "cut",
          clips: [
            { id: "vc", duration: 8, linkGroup: "take", content: { media: { mediaID: "take" } } },
          ],
        },
      ],
      audioTracks: [
        {
          id: "a",
          kind: "audio",
          rippleMode: "cut",
          clips: [
            { id: "ac", duration: 8, linkGroup: "take", content: { media: { mediaID: "take" } } },
          ],
        },
      ],
    },
  });
const lookup = () => ({
  model: "fixture",
  language: "en",
  words: [
    { text: "First.", start: 0.2, end: 0.6 },
    { text: "Second.", start: 3.2, end: 3.6 },
    { text: "Last.", start: 6.2, end: 6.6 },
  ],
});
const recipe = { id: "recipe", kind: "clean", captions: true };
const projectOnly = (coordinator: ProjectCoordinator) =>
  encodeProjectFile({ revision: 0, project: coordinator.projectFile().project });

describe("derived edits", () => {
  it("retains originals, retimes generated captions, retries idempotently and undoes the complete edit once", () => {
    const source = file();
    const original = encodeProjectFile(source);
    const session = new ProjectCoordinator(source);
    const before = projectOnly(session);
    const plan = planDerivedEdit(source, recipe, lookup);
    expect(encodeProjectFile(source)).toBe(original);
    expect(plan.original).toBe(original);
    const preview = decodeProjectFile(JSON.parse(plan.preview));
    expect(projectDuration(preview.project).seconds).toBeLessThan(8);
    const captions = preview.project.videoTracks.find((t) => t.name === "Captions")!;
    expect(captions.clips.map((c) => c.name)).toContain("Last.");
    expect(captions.clips.find((c) => c.name === "Last.")!.start.seconds).toBeLessThan(6.2);
    const applied = applyDerivedEdit(session, plan);
    expect(applyDerivedEdit(session, plan)).toEqual(applied);
    const reopened = new ProjectCoordinator(session.projectFile());
    expect(applyDerivedEdit(reopened, JSON.parse(JSON.stringify(plan)))).toEqual(applied);
    expect(session.history().undo).toHaveLength(1);
    session.undo();
    expect(projectOnly(session)).toBe(before);
    expect(session.projectFile().project.media[0]?.path).toBe("original.webm");
  });
  it("supports condensed and existing voice cleanup without modifying source resources", () => {
    const clean = planDerivedEdit(file(), recipe, lookup);
    const condensed = planDerivedEdit(file(), { ...recipe, kind: "condensed" }, lookup);
    expect(
      projectDuration(decodeProjectFile(JSON.parse(condensed.preview)).project).seconds,
    ).toBeLessThan(projectDuration(decodeProjectFile(JSON.parse(clean.preview)).project).seconds);
    const noise = planDerivedEdit(
      file(),
      { ...recipe, kind: "noise-cleaned", captions: false },
      lookup,
    );
    const project = decodeProjectFile(JSON.parse(noise.preview)).project;
    expect(effectsOf(project.audioTracks[0]!.clips[0]!, "audio")[0]?.type).toBe("voiceCleanup");
    expect(projectDuration(project).seconds).toBe(8);
    expect(project.media[0]?.path).toBe("original.webm");
  });
  it("rejects stale projects, missing transcripts and locked speech tracks", () => {
    const plan = planDerivedEdit(file(), recipe, lookup);
    const session = new ProjectCoordinator(file());
    session.apply({ commands: [{ updateProject: { patch: { name: "Changed" } } }] });
    expect(() => applyDerivedEdit(session, plan)).toThrow(/changed/);
    expect(() => planDerivedEdit(file(), recipe, () => undefined)).toThrow(/Transcribe/);
    const locked = decodeProjectFile(JSON.parse(encodeProjectFile(file())));
    const input = JSON.parse(encodeProjectFile(locked));
    input.project.audioTracks[0].locked = true;
    expect(() =>
      planDerivedEdit(decodeProjectFile(input), { ...recipe, kind: "noise-cleaned" }, lookup),
    ).toThrow(/Unlock/);
  });
});
