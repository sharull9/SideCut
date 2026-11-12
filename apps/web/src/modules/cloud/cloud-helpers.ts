// Dependency-free cloud helpers. Safe to import from the main bundle: no AuthKit or Convex here.

export const activeTeamStorageKey = "sidecut.cloud.activeTeam";

const placeholderOrigin = "https://sidecut.invalid";

// `state` round-trips through the OAuth redirect in the URL, so it is untrusted input.
// Accept only same-origin relative paths: "/x" yes, "//host" and "/\host" no, control characters no.
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === "\\") return null;
  }
  try {
    if (new URL(value, placeholderOrigin).origin !== placeholderOrigin) return null;
  } catch {
    return null;
  }
  return value;
}

// The current page as a relative path, without the one-time OAuth `code` and `state` params.
export function currentReturnTo(): string {
  const params = new URLSearchParams(window.location.search);
  params.delete("code");
  params.delete("state");
  const search = params.toString();
  return `${window.location.pathname}${search ? `?${search}` : ""}`;
}

export function returnToFromState(state: unknown): unknown {
  return typeof state === "object" && state !== null
    ? (state as { returnTo?: unknown }).returnTo
    : undefined;
}

export type TeamStorageReader = Pick<Storage, "getItem">;
export type TeamStorageWriter = Pick<Storage, "setItem" | "removeItem">;

export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readActiveTeamId(
  storage: TeamStorageReader | null = browserStorage(),
): string | null {
  try {
    return storage?.getItem(activeTeamStorageKey) || null;
  } catch {
    return null;
  }
}

export function writeActiveTeamId(
  teamId: string | null,
  storage: TeamStorageWriter | null = browserStorage(),
): void {
  try {
    if (teamId) storage?.setItem(activeTeamStorageKey, teamId);
    else storage?.removeItem(activeTeamStorageKey);
  } catch {
    // Storage can be blocked (private mode, quota). The selection still holds for this page load.
  }
}
