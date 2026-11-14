import { Component, Suspense, lazy, type ReactNode } from "react";
import { Button } from "@sidecut/ui/components/button";
import { AppPage } from "@/modules/shell/app-shell";

const CloudTeams = lazy(() => import("./teams-panel"));

class CloudErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <div role="alert" className="grid justify-items-start gap-3">
        <p>Teams could not connect. Your local project is still available.</p>
        <Button onClick={() => this.setState({ failed: false })}>Try again</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}

export function TeamPage() {
  return (
    <AppPage
      title="Team"
      description="Manage your cloud team and its library. Studio can save takes here, and any file opens in the editor."
    >
      <div className="grid gap-4">
        <CloudErrorBoundary>
          <Suspense fallback={<p role="status">Loading teams…</p>}>
            <CloudTeams />
          </Suspense>
        </CloudErrorBoundary>
      </div>
    </AppPage>
  );
}
