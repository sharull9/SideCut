import type { BrowserProjectSession } from "./browser-session";
import { AssetLibrary } from "@sidecut/platform-browser/asset-library";
import { helperPlan } from "@sidecut/core/service-speech";
import { speechLevel } from "@sidecut/core/audio-editing";
import { recordAssetUse } from "@sidecut/core/asset-use";
import { ProjectCoordinator } from "@sidecut/core/coordinator";

export async function cardsService(
  session: BrowserProjectSession,
  request: Record<string, unknown>,
  signal: AbortSignal,
) {
  const file = session.projectFile(),
    plan = helperPlan(file, "cards", request, session.analysis.transcriptFor);
  if (!("cards" in plan) || !plan.cards) throw new Error("Expected card plan.");
  const wants = request.sounds !== false && plan.cards.some((c) => !c.existingClipID);
  if (!wants)
    return {
      ...plan,
      sounds:
        request.sounds === false
          ? "no sounds (asked for none)"
          : "the cards there keep their sounds",
    };
  const library = await AssetLibrary.open();
  try {
    const entries = await Promise.all(
      ["elevenlabs:sfx_4jhasduf", "elevenlabs:sfx_k2dvisxs"].map((id) => library.get(id)),
    );
    if (entries.some((e) => !e?.normalised || e.asset.kind !== "sfx")) return plan;
    if (request.apply !== true)
      return {
        ...plan,
        sounds:
          "a whoosh on each sweep, from the asset library, on SFX (copied into the project when applied)",
      };
    const commands: unknown[] = [],
      sounds: { mediaID: string; gainDB: number; offset: number }[] = [];
    let metadata = file.project.metadata;
    for (const [i, entry] of entries.entries()) {
      if (!entry?.normalised) throw new Error("Section card sound is missing.");
      signal.throwIfAborted();
      const known = file.project.media.find(
        (m) =>
          m.asset &&
          typeof m.asset === "object" &&
          "id" in m.asset &&
          m.asset.id === entry.asset.id,
      );
      const id = known?.id ?? `med_${crypto.randomUUID()}`,
        path = known?.path ?? `assets/sfx/card-${i}-${id}.wav`;
      if (!known || (await session.resource(id))?.state !== "available")
        await session.stageServiceResource(file.project.id, id, entry.normalised, signal);
      if (entry.licence)
        await session.stageServiceResource(
          file.project.id,
          `asset-licence:${entry.asset.id}`,
          entry.licence,
          signal,
        );
      if (!known)
        commands.push({
          addMedia: {
            item: {
              id,
              path,
              kind: "audio",
              role: "sfx",
              hasAudio: true,
              duration: entry.asset.duration ?? null,
              asset: entry.asset,
            },
          },
        });
      metadata = recordAssetUse(
        { ...file.project, metadata },
        { asset: entry.asset, mediaID: id, path },
      );
      sounds.push({
        mediaID: id,
        gainDB: Math.round(((i === 0 ? -5.4 : -8.3) + speechLevel(file.project) + 20) * 10) / 10,
        offset: 0,
      });
    }
    commands.push({ updateProject: { patch: { metadata } } });
    for (const command of plan.commands)
      commands.push({
        addSectionCards: { ...command.addSectionCards, soundIn: sounds[0], soundOut: sounds[1] },
      });
    const preview = new ProjectCoordinator(file),
      result = preview.apply({ commands });
    signal.throwIfAborted();
    return {
      ...plan,
      commands,
      sounds: "a whoosh on each sweep, from the asset library, on SFX",
      warnings: [...new Set([...plan.warnings, ...result.warnings])],
    };
  } finally {
    library.close();
  }
}
