import { useEffect, useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { isCloudPath } from "./cloud-activation";
import { useCloud } from "./cloud-context";

// Renders nothing. Mount it once under CloudProvider in the root.
// Cloud decides activation at first render. If the user then moves in-app to a cloud page while
// cloud is dormant, the providers cannot mount without remounting the route tree. Reload that
// page instead, so the providers mount at first render.
export function CloudRouteGuard() {
  const { configured, available, activate } = useCloud();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const requested = useRef(false);
  useEffect(() => {
    if (configured || !available || !isCloudPath(pathname) || requested.current) return;
    requested.current = true;
    activate();
  }, [configured, available, pathname, activate]);
  return null;
}
