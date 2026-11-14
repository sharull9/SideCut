import { Suspense, lazy, useCallback, useRef, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { Button } from "@sidecut/ui/components/button";
import { useCloud } from "@/modules/cloud/cloud-provider";
import { AppPage } from "@/modules/shell/app-shell";
import { useEditorSession } from "@/modules/workspace/editor-session";
import { LOCAL_ONLY, useStudioCloud } from "@/modules/cloud/studio-cloud";
import { billingEnabledAtBuild } from "@/modules/billing/billing-flag";

const StudioPanel = lazy(() => import("./studio-panel"));
// Billing code (Convex) is fetched only in builds where billing is on.
const SubscriptionGate = lazy(() =>
  import("@/modules/billing/subscription-gate").then((m) => ({ default: m.SubscriptionGate })),
);

function CloudStudioPanel({ onBusy }: { onBusy: (busy: boolean) => void }) {
  return <StudioPanel onBusy={onBusy} cloud={useStudioCloud()} />;
}

export function StudioPage() {
  const { configured } = useCloud();
  const { snapshot } = useEditorSession();
  // A ref, not state: Studio clears it right before navigating to the editor after an upload.
  const busy = useRef(false);
  const [, setBusyView] = useState(false);
  const onBusy = useCallback((next: boolean) => {
    busy.current = next;
    setBusyView(next);
  }, []);
  // Leaving releases devices and in-memory takes, so unsaved output must be resolved first.
  const blocker = useBlocker({
    shouldBlockFn: () => busy.current,
    enableBeforeUnload: () => busy.current,
    withResolver: true,
  });
  return (
    <AppPage
      title="Studio"
      description="Mix scenes and live sources, then record the program to this device or your team's cloud."
    >
      {blocker.status === "blocked" && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3"
        >
          <p>
            Stop the recording, let the upload finish, or add or discard the take before leaving.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => blocker.reset()}>
              Stay in Studio
            </Button>
            <Button size="sm" variant="destructive" onClick={() => blocker.proceed()}>
              Leave and discard
            </Button>
          </div>
        </div>
      )}
      {/* Scenes are stored per project, so the real project must be open first. */}
      {snapshot.saveState === "loading" ? (
        <p role="status">Opening project…</p>
      ) : (
        <Suspense fallback={<p role="status">Loading studio…</p>}>
          {configured && billingEnabledAtBuild() ? (
            <SubscriptionGate feature="Live studio">
              <CloudStudioPanel onBusy={onBusy} />
            </SubscriptionGate>
          ) : configured ? (
            <CloudStudioPanel onBusy={onBusy} />
          ) : (
            <StudioPanel onBusy={onBusy} cloud={LOCAL_ONLY} />
          )}
        </Suspense>
      )}
    </AppPage>
  );
}
