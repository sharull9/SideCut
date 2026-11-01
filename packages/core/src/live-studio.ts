import { Schema } from "effect";
import { decodeProjectFile, encodeProjectFile } from "@sidecut/contracts/project";
import type { Project } from "@sidecut/contracts/project";
import { framePlan } from "./render-plan";
import { projectLiveAssets } from "./live-assets";

const sceneSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  revision: Schema.Int,
  snapshot: Schema.String,
});
const studioSchema = Schema.Struct({
  schemaVersion: Schema.Literals([1]),
  revision: Schema.Int,
  scenes: Schema.Array(sceneSchema),
  active: Schema.NullOr(sceneSchema),
  activeCommitRevision: Schema.Int,
});
type SavedScene = typeof sceneSchema.Type;

function sceneProject(scene: SavedScene) {
  const project = decodeProjectFile(JSON.parse(scene.snapshot)).project;
  projectLiveAssets(project);
  return project;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Saved editor compositions; the active snapshot changes only on an explicit switch. */
export class LiveStudio {
  private revision = 0;
  private scenes = new Map<string, SavedScene>();
  private active: { scene: SavedScene; project: Project; commitRevision: number } | null = null;

  get currentRevision() {
    return this.revision;
  }
  list() {
    return [...this.scenes.values()].map(({ id, name, revision }) => ({ id, name, revision }));
  }
  /** An editable copy of a saved scene; changes apply only through save and switch. */
  project(id: string) {
    const scene = this.scenes.get(id);
    if (!scene) throw new Error("Scene unavailable.");
    return sceneProject(scene);
  }
  get activeScene() {
    return this.active
      ? {
          id: this.active.scene.id,
          revision: this.active.scene.revision,
          commitRevision: this.active.commitRevision,
        }
      : null;
  }
  private check(expected: number) {
    if (
      expected !== this.revision ||
      !Number.isSafeInteger(expected) ||
      expected === Number.MAX_SAFE_INTEGER
    )
      throw new Error("Studio changed. Refresh and retry.");
  }
  save(args: { id: string; name: string; project: Project; expectedRevision: number }) {
    this.check(args.expectedRevision);
    const name = args.name.trim();
    if (!args.id || args.id.length > 100 || !name || name.length > 100)
      throw new Error("Scene needs an ID and a name of 1–100 characters.");
    if (!this.scenes.has(args.id) && this.scenes.size >= 100)
      throw new Error("Studio supports at most 100 saved scenes.");
    const snapshot = encodeProjectFile({ revision: 0, project: args.project });
    if (snapshot.length > 2_000_000) throw new Error("Scene snapshot exceeds 2 MB.");
    const scene = {
      id: args.id,
      name,
      revision: (this.scenes.get(args.id)?.revision ?? 0) + 1,
      snapshot,
    };
    sceneProject(scene);
    const candidates = [...this.scenes.values()].filter((s) => s.id !== scene.id).concat(scene);
    if (
      JSON.stringify({
        schemaVersion: 1,
        revision: this.revision + 1,
        scenes: candidates,
        active: this.active?.scene ?? null,
        activeCommitRevision: this.active?.commitRevision ?? 0,
      }).length > 20_000_000
    )
      throw new Error("Studio file exceeds 20 MB.");
    this.scenes.set(args.id, scene);
    this.revision++;
    return this.revision;
  }
  switch(args: { id: string; expectedRevision: number }) {
    this.check(args.expectedRevision);
    const scene = this.scenes.get(args.id);
    if (!scene) throw new Error("Scene unavailable.");
    const project = freeze(sceneProject(scene));
    if (
      this.active &&
      (this.active.project.settings.width !== project.settings.width ||
        this.active.project.settings.height !== project.settings.height ||
        this.active.project.settings.frameRate.numerator !== project.settings.frameRate.numerator ||
        this.active.project.settings.frameRate.denominator !==
          project.settings.frameRate.denominator)
    )
      throw new Error("Live scenes must use the same output size and frame rate.");
    this.revision++;
    this.active = { scene, project, commitRevision: this.revision };
    return this.revision;
  }
  remove(args: { id: string; expectedRevision: number }) {
    this.check(args.expectedRevision);
    if (this.active?.scene.id === args.id)
      throw new Error("Switch away before removing the active scene.");
    if (!this.scenes.delete(args.id)) throw new Error("Scene unavailable.");
    this.revision++;
  }
  frame(time: number) {
    if (!Number.isFinite(time) || time < 0) throw new Error("Invalid studio time.");
    const active = this.active;
    if (!active) throw new Error("Select a scene first.");
    return {
      sceneId: active.scene.id,
      sceneRevision: active.scene.revision,
      commitRevision: active.commitRevision,
      project: active.project,
      assets: projectLiveAssets(active.project),
      plan: framePlan(active.project, time),
    };
  }
  serialize() {
    return JSON.stringify({
      schemaVersion: 1,
      revision: this.revision,
      scenes: [...this.scenes.values()],
      active: this.active?.scene ?? null,
      activeCommitRevision: this.active?.commitRevision ?? 0,
    });
  }
  static restore(encoded: string) {
    if (encoded.length > 20_000_000) throw new Error("Studio file exceeds 20 MB.");
    const state = Schema.decodeUnknownSync(studioSchema)(JSON.parse(encoded));
    if (
      !Number.isSafeInteger(state.revision) ||
      state.revision < 0 ||
      state.activeCommitRevision < 0 ||
      state.activeCommitRevision > state.revision ||
      state.scenes.length > 100 ||
      new Set(state.scenes.map((s) => s.id)).size !== state.scenes.length
    )
      throw new Error("Invalid studio state.");
    const studio = new LiveStudio();
    for (const scene of [...state.scenes, ...(state.active ? [state.active] : [])]) {
      if (
        !scene.id ||
        scene.id.length > 100 ||
        !scene.name.trim() ||
        scene.name.length > 100 ||
        scene.revision < 1 ||
        scene.snapshot.length > 2_000_000
      )
        throw new Error("Invalid saved scene.");
      sceneProject(scene);
    }
    studio.scenes = new Map(state.scenes.map((s) => [s.id, s]));
    studio.revision = state.revision;
    if (state.active) {
      const saved = studio.scenes.get(state.active.id);
      if (!saved || saved.revision < state.active.revision || state.activeCommitRevision < 1)
        throw new Error("Active scene is missing or inconsistent.");
      studio.active = {
        scene: state.active,
        project: freeze(sceneProject(state.active)),
        commitRevision: state.activeCommitRevision,
      };
    }
    return studio;
  }
}

/** Each rendition owns its scene revisions and composition; it is encoded separately. */
export class LiveStudioRenditions {
  readonly horizontal = new LiveStudio();
  readonly vertical = new LiveStudio();

  save(args: {
    output: "horizontal" | "vertical";
    id: string;
    name: string;
    project: Project;
    expectedRevision: number;
  }) {
    const { width, height } = args.project.settings;
    if (args.output === "horizontal" ? width <= height : height <= width)
      throw new Error("Composition dimensions do not match the selected output.");
    if (width > 3840 || height > 3840 || width * height > 3840 * 2160)
      throw new Error("Studio output exceeds the 4K pixel limit.");
    return this[args.output].save(args);
  }
}

export const liveQualityProfiles = {
  standard: { framesPerSecond: 30, videoBitsPerSecond: 4_000_000, audioBitsPerSecond: 128_000 },
  high: { framesPerSecond: 60, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 },
} as const;
