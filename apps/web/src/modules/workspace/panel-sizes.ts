export const PANEL_STORAGE_KEY = "sidecut.panel-sizes.v1";
export interface PanelSizes {
  media: number;
  inspector: number;
  workspace: number | null;
  mediaHidden: boolean;
  inspectorHidden: boolean;
}
export const DEFAULT_PANELS: PanelSizes = {
  media: 264,
  inspector: 300,
  workspace: null,
  mediaHidden: false,
  inspectorHidden: false,
};
export const MEDIA_MIN = 240;
export const INSPECTOR_MIN = 300;
export const VIEWER_MIN = 420;
export const WORKSPACE_MIN = 260;
export const TIMELINE_MIN = 176;
export const DIVIDER_SIZE = 6;
// Width of the strip a hidden side panel collapses to; it holds the button that shows it again.
export const RAIL_SIZE = 32;
export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function readPanelSizes(value: string | null): PanelSizes {
  if (!value) return { ...DEFAULT_PANELS };
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("media" in parsed) ||
      !("inspector" in parsed) ||
      !("workspace" in parsed)
    )
      return { ...DEFAULT_PANELS };
    if (
      typeof parsed.media !== "number" ||
      !Number.isFinite(parsed.media) ||
      typeof parsed.inspector !== "number" ||
      !Number.isFinite(parsed.inspector) ||
      !(
        parsed.workspace === null ||
        (typeof parsed.workspace === "number" && Number.isFinite(parsed.workspace))
      )
    )
      return { ...DEFAULT_PANELS };
    return {
      media: clamp(parsed.media, MEDIA_MIN, 560),
      inspector: clamp(parsed.inspector, INSPECTOR_MIN, 600),
      workspace: parsed.workspace,
      // Older preferences have no visibility fields; treat them as shown.
      mediaHidden: "mediaHidden" in parsed && parsed.mediaHidden === true,
      inspectorHidden: "inspectorHidden" in parsed && parsed.inspectorHidden === true,
    };
  } catch {
    return { ...DEFAULT_PANELS };
  }
}

export function fitPanels(sizes: PanelSizes, width: number, height: number) {
  let media = sizes.mediaHidden ? RAIL_SIZE : clamp(sizes.media, MEDIA_MIN, 560);
  let inspector = sizes.inspectorHidden ? RAIL_SIZE : clamp(sizes.inspector, INSPECTOR_MIN, 600);
  const dividers =
    (sizes.mediaHidden ? 0 : DIVIDER_SIZE) + (sizes.inspectorHidden ? 0 : DIVIDER_SIZE);
  const overflow = media + inspector + VIEWER_MIN + dividers - width;
  const spareMedia = sizes.mediaHidden ? 0 : media - MEDIA_MIN;
  const spareInspector = sizes.inspectorHidden ? 0 : inspector - INSPECTOR_MIN;
  const spare = spareMedia + spareInspector;
  if (overflow > 0 && spare > 0) {
    const remove = Math.min(overflow, spare);
    media -= (remove * spareMedia) / spare;
    inspector -= (remove * spareInspector) / spare;
  }
  const workspaceMax = Math.max(WORKSPACE_MIN, height - TIMELINE_MIN - DIVIDER_SIZE);
  return {
    media,
    inspector,
    workspace: clamp(sizes.workspace ?? height * 0.6, WORKSPACE_MIN, workspaceMax),
  };
}
