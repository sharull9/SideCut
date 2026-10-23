// Based on TandemMedia/TakePairing.swift. See tests/fixtures/tandem/TANDEM-LICENSE.
import type { MediaItem } from "@sidecut/contracts/project";

export interface TakeSidecar {
  version: 1;
  files: { role: string; file?: string; startHostTime: number }[];
}
export function takeName(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const match = /^(.*\/)?([^/]+)-(camera|screen)\.[^.]+$/i.exec(normalized);
  return match
    ? {
        folder: match[1] ?? "",
        base: match[2]!,
        role: match[3]!.toLowerCase() as "camera" | "screen",
      }
    : null;
}
export function decodeTakeSidecar(value: unknown): TakeSidecar {
  const item = value as TakeSidecar;
  if (
    !item ||
    item.version !== 1 ||
    !Array.isArray(item.files) ||
    !item.files.length ||
    item.files.some(
      (f) =>
        !f ||
        typeof f.role !== "string" ||
        (f.file !== undefined && typeof f.file !== "string") ||
        !Number.isFinite(f.startHostTime),
    )
  )
    throw new Error("Take sidecar needs version 1 and finite file startHostTime values.");
  return item;
}
export function pairTakes(
  media: readonly MediaItem[],
  sidecars: ReadonlyMap<string, TakeSidecar> = new Map(),
) {
  const groups = new Map<
    string,
    { item: MediaItem; name: NonNullable<ReturnType<typeof takeName>> }[]
  >();
  const notes: string[] = [];
  const commands: {
    updateMedia: { mediaID: string; patch: { role: string; takeID: string; takeOffset: number } };
  }[] = [];
  for (const item of media) {
    const name = item.kind === "video" ? takeName(item.path) : null;
    if (!name) continue;
    const key = `${name.folder}${name.base}`.toLowerCase();
    const group = groups.get(key) ?? [];
    group.push({ item, name });
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    if (group.length !== 2 || new Set(group.map((g) => g.name.role)).size !== 2) {
      notes.push(`Take ${key} is ambiguous. Set roles and take IDs manually.`);
      continue;
    }
    const takeID = group.find((g) => g.item.takeID)?.item.takeID ?? `take:${key}`;
    if (new Set(group.map((g) => g.item.takeID).filter(Boolean)).size > 1) {
      notes.push(`Take ${key} has conflicting IDs. Resolve them manually.`);
      continue;
    }
    const sidecar = sidecars.get(`${key}.take.json`);
    const starts = group.map(
      ({ item, name }) =>
        sidecar?.files.find(
          (f) =>
            (f.file ?? `${name.base}-${f.role}.mov`).toLowerCase() ===
            item.path.split(/[\\/]/).at(-1)?.toLowerCase(),
        ) ?? sidecar?.files.find((f) => f.role.toLowerCase() === name.role),
    );
    const earliest = Math.min(...starts.flatMap((f) => (f ? [f.startHostTime] : [])));
    if (!sidecar)
      notes.push(
        `Take ${key}: no recorder creation dates are available in this browser; existing offsets are kept, otherwise files start together. Import a .take.json sidecar or align by sound.`,
      );
    group.forEach(({ item, name }, i) => {
      let offset = starts[i]
        ? starts[i]!.startHostTime - earliest
        : (item.takeOffset?.seconds ?? 0);
      if (
        !Number.isFinite(offset) ||
        offset < 0 ||
        offset > 30 ||
        (item.duration && offset >= item.duration.seconds)
      ) {
        notes.push(`Take ${key}: invalid offset for ${item.path}; using zero.`);
        offset = 0;
      }
      commands.push({
        updateMedia: { mediaID: item.id, patch: { role: name.role, takeID, takeOffset: offset } },
      });
    });
  }
  return { commands, notes };
}
