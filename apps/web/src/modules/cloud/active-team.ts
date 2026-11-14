import { useCallback, useSyncExternalStore } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@sidecut/cloud/api";
import type { FunctionReturnType } from "convex/server";

const KEY = "sidecut.activeTeam";
const EVENT = "sidecut:active-team";
type Membership = FunctionReturnType<typeof api.teams.list>[number];
export type ActiveTeam = Membership & { team: NonNullable<Membership["team"]> };

const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const subscribe = (listener: () => void) => {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
};

/** The team chosen on Team, remembered on this device and shared with Studio. */
export function useActiveTeamId() {
  const id = useSyncExternalStore(subscribe, read, () => null);
  const set = useCallback((next: string) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private browsing: the choice lasts for this page only.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [id, set] as const;
}

/** Signed-in state and the active team. Only call inside CloudProvider when cloud is configured. */
export function useActiveTeam() {
  const auth = useConvexAuth();
  const teams = useQuery(api.teams.list, auth.isAuthenticated ? {} : "skip");
  const [id, setId] = useActiveTeamId();
  const usable = teams?.filter((entry): entry is ActiveTeam => Boolean(entry.team));
  const current = usable?.find((entry) => entry.team._id === id) ?? usable?.[0];
  return { ...auth, teams: usable, current, select: setId };
}
