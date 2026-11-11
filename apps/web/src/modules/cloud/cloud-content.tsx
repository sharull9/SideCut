import { Component, Suspense, lazy, type ReactNode } from "react";
import { Button } from "@sidecut/ui/components/button";

const CloudTeams = lazy(() => import("./teams-panel"));

class CloudErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <div role="alert" className="grid justify-items-start gap-3">
        <p>Cloud features could not connect. Try connecting again.</p>
        <Button onClick={() => this.setState({ failed: false })}>Try again</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}

export function CloudContent({ view = "all" }: { view?: "all" | "team" | "library" }) {
  return (
    <CloudErrorBoundary>
      <Suspense fallback={<p role="status">Loading cloud workspace…</p>}>
        <CloudTeams view={view} />
      </Suspense>
    </CloudErrorBoundary>
  );
}
