import { createContext, useContext } from "react";

export type CloudState = {
  // True only when the AuthKit and Convex providers are mounted. Components that call Convex hooks
  // must render only when this is true.
  configured: boolean;
  // True when the deployment has cloud config, even if this page is not yet using cloud.
  available: boolean;
  activeTeamId: string | null;
  setActiveTeamId(id: string | null): void;
  // Starts cloud on this page with a full load. A no-op once configured.
  activate(): void;
};

const noop = () => {};

export const dormantCloud: CloudState = {
  configured: false,
  available: false,
  activeTeamId: null,
  setActiveTeamId: noop,
  activate: noop,
};

export const CloudContext = createContext<CloudState>(dormantCloud);

export function useCloud(): CloudState {
  return useContext(CloudContext);
}
