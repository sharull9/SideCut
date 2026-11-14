import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@sidecut/cloud/api";
import type { FunctionReturnType } from "convex/server";
import { useCloud } from "./cloud-context";

type Membership = FunctionReturnType<typeof api.teams.list>[number];
export type ActiveTeam = Membership & { team: NonNullable<Membership["team"]> };

/** The team chosen on Team, remembered on this device and shared with Studio and Library. */
export function useActiveTeamId() {
  const { activeTeamId, setActiveTeamId } = useCloud();
  return [activeTeamId, setActiveTeamId] as const;
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
