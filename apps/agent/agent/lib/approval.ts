/** Decides which raE.E tool calls wait for the user's approval in the Assistant panel. */
export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
};

/** Helpers that only preview unless called with apply:true. */
const previewHelpers = new Set(["tighten", "join", "captions", "short", "cards", "restore"]);
/** Tools that change things unless called with dryRun:true. */
const dryRunTools = new Set(["sync", "archive", "relink"]);
/** Work that creates files or reads media without changing the timeline. */
const freeWrites = new Set(["media", "transcribe", "clip", "watch", "wait"]);
const readOnlyStudio = new Set(["status", "recording-status"]);

export function needsApproval(
  name: string,
  input: Record<string, unknown> | undefined,
  annotations: ToolAnnotations | undefined,
) {
  // Paid generation and provider downloads always ask, whatever the input says.
  if (name === "assets_generate" || name === "assets_use") return true;
  if (name === "studio") return !readOnlyStudio.has(String(input?.action ?? ""));
  if (annotations?.readOnlyHint === true) return false;
  if (previewHelpers.has(name)) return input?.apply === true;
  if (dryRunTools.has(name)) return input?.dryRun !== true;
  if (freeWrites.has(name)) return false;
  return true;
}
