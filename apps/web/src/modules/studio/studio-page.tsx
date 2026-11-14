import { Suspense, lazy, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { Button } from "@sidecut/ui/components/button";
import { AppPage } from "@/modules/shell/app-shell";
import { useEditorSession } from "@/modules/workspace/editor-session";

const StudioPanel = lazy(() => import("./studio-panel"));

export function StudioPage() {
  const [busy, setBusy] = useState(false);
  const { snapshot } = useEditorSession();
  // Leaving releases devices and in-memory takes, so unsaved output must be resolved first.
  const blocker = useBlocker({
    shouldBlockFn: () => busy,
    enableBeforeUnload: () => busy,
    withResolver: true,
  });
  return (
    <AppPage
      title="Studio"
      description="Switch saved scenes, mix live sources and record the program output on this device."
    >
      {blocker.status === "blocked" && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3"
        >
          <p>Stop the recording and add or discard the take before leaving.</p>
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
          <StudioPanel onBusy={setBusy} />
        </Suspense>
      )}
    </AppPage>
  );
}
