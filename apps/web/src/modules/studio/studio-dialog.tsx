import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@sidecut/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@sidecut/ui/components/dialog";
import { useEditorSession } from "@/modules/workspace/editor-session";
import { SubscriptionGate } from "@/modules/billing/subscription-gate";

const StudioPanel = lazy(() => import("./studio-panel"));

export function StudioDialog({ openOnMount = false }: { openOnMount?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const { snapshot } = useEditorSession();
  const navigate = useNavigate();
  const openedFromRoute = useRef(false);
  useEffect(() => {
    // Wait for the project to finish loading: scenes are stored per project.
    if (!openOnMount || openedFromRoute.current || snapshot.saveState === "loading") return;
    openedFromRoute.current = true;
    setOpen(true);
    // Clear the one-time ?studio=open param so a reload or back navigation does not reopen it.
    void navigate({ to: "/", search: {}, replace: true });
  }, [openOnMount, snapshot.saveState, navigate]);
  return (
    <>
      {/* Scenes are stored per project, so the real project must be open first. */}
      <Button
        variant="ghost"
        size="sm"
        disabled={snapshot.saveState === "loading"}
        onClick={() => setOpen(true)}
      >
        Studio
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Closing releases devices and in-memory takes, so unsaved output must be resolved first.
          if (!next && busy) {
            setBlocked(true);
            return;
          }
          setBlocked(false);
          setOpen(next);
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-5xl">
          <DialogTitle>Live studio</DialogTitle>
          <DialogDescription>
            Switch saved scenes, mix live sources and record the program output on this device.
          </DialogDescription>
          {blocked && busy && (
            <p role="alert">Stop the recording and add or discard the take before closing.</p>
          )}
          {open && (
            <SubscriptionGate feature="Live studio">
              <Suspense fallback={<p role="status">Loading studio…</p>}>
                <StudioPanel onBusy={setBusy} />
              </Suspense>
            </SubscriptionGate>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
