import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { Button } from "@sidecut/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@sidecut/ui/components/dialog";

const CloudTeams = lazy(() => import("./teams-panel"));

class CloudErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <div role="alert">
        <p>Teams could not connect. Your local project is still available.</p>
        <Button onClick={() => this.setState({ failed: false })}>Try again</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}

export function TeamsDialog() {
  const [open, setOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("code") && params.has("state");
  });
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Teams
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogTitle>Teams</DialogTitle>
          <DialogDescription>
            Manage your cloud team. Editing and recordings stay on this device.
          </DialogDescription>
          {open && (
            <CloudErrorBoundary>
              <Suspense fallback={<p role="status">Loading teams…</p>}>
                <CloudTeams />
              </Suspense>
            </CloudErrorBoundary>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
