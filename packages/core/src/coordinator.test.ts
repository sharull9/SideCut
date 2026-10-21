import { describe, expect, it } from "vite-plus/test";
import { decodeProjectFile } from "@sidecut/contracts/project";
import empty from "../../../tests/fixtures/tandem/empty.json";
import mini from "../../../tests/fixtures/tandem/mini.json";
import { ProjectCoordinator } from "./coordinator";

const session = () => new ProjectCoordinator(decodeProjectFile(empty));

describe("atomic project session", () => {
  it("uses reference defaults for missing or null batch fields", () => {
    const coordinator = session();
    expect(
      coordinator.apply({
        label: null,
        author: null,
        expectedRevision: null,
        idempotencyKey: null,
        commands: [],
      }),
    ).toMatchObject({ label: "Edit", author: "user", revision: 1 });
  });

  it("rejects a later failed command without publishing any change or undo entry", () => {
    const coordinator = session();
    const before = coordinator.getSnapshot();
    let published = 0;
    coordinator.subscribe(() => {
      published++;
    });
    expect(() =>
      coordinator.apply({
        label: "Broken batch",
        commands: [
          { updateProject: { patch: { name: "Must not commit" } } },
          { updateSettings: { patch: { width: 0 } } },
        ],
      }),
    ).toThrow(/command 2 of 2/);
    expect(coordinator.getSnapshot()).toBe(before);
    expect(coordinator.undo()).toBeNull();
    expect(published).toBe(0);
  });

  it("rejects stale revisions and returns the original result for an idempotent retry", () => {
    const coordinator = session();
    const batch = {
      expectedRevision: 0,
      idempotencyKey: "request-1",
      commands: [{ updateProject: { patch: { name: "New name" } } }],
    };
    const result = coordinator.apply(batch);
    expect(coordinator.apply(batch)).toBe(result);
    expect(coordinator.getSnapshot().revision).toBe(1);
    expect(() => coordinator.apply({ ...batch, idempotencyKey: "request-2" })).toThrow(
      /expected 0, actual 1/,
    );
    expect(coordinator.getSnapshot().project.name).toBe("New name");
  });

  it("publishes one snapshot for a multi-command batch and restores exact values with monotonic undo/redo revisions", () => {
    const coordinator = session();
    const before = coordinator.getSnapshot().project;
    const revisions: number[] = [];
    const unsubscribe = coordinator.subscribe(() => {
      revisions.push(coordinator.getSnapshot().revision);
    });
    coordinator.apply({
      label: "Prepare sequence",
      author: "test-agent",
      commands: [
        { updateProject: { patch: { name: "Portrait study", metadata: { author: "Alex" } } } },
        { updateSettings: { patch: { width: 1080, height: 1920 } } },
      ],
    });
    const after = coordinator.getSnapshot().project;
    expect(coordinator.getSnapshot().undoLabel).toBe("Prepare sequence");
    expect(revisions).toEqual([1]);
    coordinator.undo();
    expect(coordinator.getSnapshot().project).toEqual(before);
    expect(coordinator.getSnapshot().redoLabel).toBe("Prepare sequence");
    coordinator.redo();
    expect(coordinator.getSnapshot().project).toEqual(after);
    expect(revisions).toEqual([1, 2, 3]);
    unsubscribe();
    coordinator.undo();
    expect(revisions).toEqual([1, 2, 3]);
    coordinator.apply({ commands: [{ updateProject: { patch: { name: "Different branch" } } }] });
    expect(coordinator.redo()).toBeNull();
  });

  it("merges metadata recursively, deletes null keys, and prohibits protected project fields", () => {
    const coordinator = session();
    coordinator.apply({
      commands: [{ updateProject: { patch: { metadata: { a: "A", b: "B" } } } }],
    });
    coordinator.apply({
      commands: [{ updateProject: { patch: { metadata: { a: null, c: "C" } } } }],
    });
    expect(coordinator.getSnapshot().project.metadata).toEqual({ b: "B", c: "C" });
    expect(() =>
      coordinator.apply({ commands: [{ updateProject: { patch: { id: "new-id" } } }] }),
    ).toThrow(/name and metadata/);
    expect(() =>
      coordinator.apply({ commands: [{ updateProject: { patch: { name: null } } }] }),
    ).toThrow();
    expect(() => coordinator.apply({ commands: [{ addTrack: {} }] })).toThrow();
    expect(() =>
      coordinator.apply({
        commands: [{ updateProject: { patch: {} }, updateSettings: { patch: {} } }],
      }),
    ).toThrow(/exactly one/);
  });

  it("matches frame-rate warnings, partial settings patches, and speech normalization changes on unlocked audio tracks", () => {
    const file = decodeProjectFile(mini);
    const project = {
      ...file.project,
      audioTracks: [
        file.project.audioTracks[0]!,
        {
          ...file.project.audioTracks[0]!,
          id: "trk_locked",
          locked: true,
          clips: file.project.audioTracks[0]!.clips.map((c) => ({
            ...c,
            id: "clip_locked",
            linkGroup: null,
          })),
        },
      ],
    };
    const coordinator = new ProjectCoordinator({ ...file, project });
    const result = coordinator.apply({
      commands: [
        { updateSettings: { patch: { frameRate: { numerator: 24 }, speechLoudness: -18 } } },
      ],
    });
    expect(coordinator.getSnapshot().project.settings.frameRate).toEqual({
      numerator: 24,
      denominator: 1001,
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Frame rate changed"),
        expect.stringContaining("Locked track"),
      ]),
    );
    expect(coordinator.getSnapshot().project.audioTracks[0]!.clips[0]!.audio?.normalizeTo).toBe(
      -18,
    );
    expect(coordinator.getSnapshot().project.audioTracks[1]!.clips[0]!.audio?.normalizeTo).toBe(
      -20,
    );
    expect(() =>
      coordinator.apply({ commands: [{ updateSettings: { patch: { speechLoudness: -50 } } }] }),
    ).toThrow(/between -40 and -10/);
  });

  it("protects published values and isolates observer failures/reentrant edits", () => {
    const file = decodeProjectFile(empty);
    const coordinator = new ProjectCoordinator(file);
    expect(Object.isFrozen(coordinator.getSnapshot().project.settings)).toBe(true);
    expect(Object.isFrozen(file.project)).toBe(false);
    coordinator.subscribe(() => {
      throw new Error("bad observer");
    });
    let reentrant = false;
    coordinator.subscribe(() => {
      try {
        coordinator.apply({ commands: [] });
      } catch {
        reentrant = true;
      }
    });
    expect(coordinator.apply({ commands: [] }).revision).toBe(1);
    expect(reentrant).toBe(true);
  });
});
