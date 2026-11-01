import { Schema } from "effect";
import { EditBatchSchema } from "@sidecut/contracts/commands";
import { encodeProjectFile, decodeProjectFile, type ProjectFile } from "@sidecut/contracts/project";
import { ProjectCoordinator } from "./coordinator";
import { planTighten, planCaptions, type Transcripts } from "./speech";
import { effectsOf } from "./effect-editing";
import { speechMediaID } from "./audio-editing";

const recipeSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]{1,80}$/)),
  kind: Schema.Literals(["clean", "condensed", "noise-cleaned"]),
  captions: Schema.Boolean,
});

/** A frozen original and replayable batch; planning never mutates the source session. */
export function planDerivedEdit(file: ProjectFile, input: unknown, transcripts: Transcripts) {
  const recipe = Schema.decodeUnknownSync(recipeSchema)(input);
  const original = encodeProjectFile(file);
  if (original.length > 20_000_000) throw new Error("Derived snapshot exceeds 20 MB.");
  const scratch = new ProjectCoordinator(decodeProjectFile(JSON.parse(original)));
  const commands: unknown[] = [];
  const warnings: string[] = [];
  if (recipe.kind !== "noise-cleaned") {
    const plan = planTighten(
      file,
      recipe.kind === "clean" ? { min: 0.8, keep: 0.3 } : { min: 0.5, keep: 0.12 },
      transcripts,
    );
    if (plan.locked || plan.missing.length)
      throw new Error(plan.locked ?? "Transcribe all speech sources before deriving edits.");
    warnings.push(...plan.warnings);
    commands.push(...plan.commands);
  } else {
    for (const track of file.project.audioTracks)
      for (const clip of track.clips) {
        if (!speechMediaID(file.project, track, clip)) continue;
        if (track.locked) throw new Error("Unlock speech tracks before deriving cleanup.");
        const existing = effectsOf(clip, "audio").find((effect) => effect.type === "voiceCleanup");
        commands.push(
          existing
            ? { updateEffect: { clipID: clip.id, effectID: existing.id, patch: { enabled: true } } }
            : { addEffect: { clipID: clip.id, effect: { type: "voiceCleanup", enabled: true } } },
        );
      }
    if (!commands.length) throw new Error("No speech audio clips available for cleanup.");
    warnings.push("Voice cleanup uses the existing filter; it is not neural speaker isolation.");
  }
  const label = `Derived ${recipe.kind}`;
  if (commands.length) scratch.apply({ label, commands });
  if (recipe.captions) {
    const project = scratch.projectFile().project;
    const existing = project.videoTracks.find((track) => track.name.toLowerCase() === "captions");
    if (existing?.locked) throw new Error("Unlock the caption track before regenerating captions.");
    if (existing?.clips.some((clip) => !clip.tags.includes("captions")))
      throw new Error("The Captions track contains non-caption clips; rename it before deriving.");
    const remove = existing ? [{ removeTrack: { trackID: existing.id } }] : [];
    if (remove.length) scratch.apply({ commands: remove });
    const captions = planCaptions(
      scratch.projectFile(),
      {},
      transcripts,
      () => `derived_${recipe.id}_captions`,
    );
    if (captions.missing.length)
      throw new Error("Transcribe all speech sources before captioning.");
    commands.push(...remove, ...captions.commands);
    if (captions.commands.length) scratch.apply({ commands: captions.commands });
    warnings.push(...captions.warnings);
  }
  if (!commands.length) throw new Error("No derived changes proposed.");
  const batch = Schema.encodeSync(EditBatchSchema)(
    Schema.decodeUnknownSync(EditBatchSchema)({
      label,
      author: "derived-edit",
      expectedRevision: file.revision,
      idempotencyKey: `derived:${file.project.id}:${file.revision}:${recipe.id}:${recipe.kind}:${recipe.captions}`,
      commands,
    }),
  );
  const review = new ProjectCoordinator(decodeProjectFile(JSON.parse(original)));
  review.apply(batch);
  return { recipe, original, batch, preview: encodeProjectFile(review.projectFile()), warnings };
}

export function applyDerivedEdit(
  coordinator: ProjectCoordinator,
  plan: ReturnType<typeof planDerivedEdit>,
) {
  // Compare the actual content as well as revision; a recipe cannot cross into another project.
  const content = (file: ProjectFile) =>
    encodeProjectFile({ revision: file.revision, project: file.project });
  const current = content(coordinator.projectFile());
  if (
    current !== content(decodeProjectFile(JSON.parse(plan.original))) &&
    current !== content(decodeProjectFile(JSON.parse(plan.preview)))
  )
    throw new Error("Original project changed. Regenerate and review the derived edit.");
  return coordinator.apply(plan.batch);
}
