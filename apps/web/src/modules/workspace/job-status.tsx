import { useSyncExternalStore } from "react";
import { useEditorSession } from "./editor-session";
import { Button } from "@sidecut/ui/components/button";
export function JobStatus() {
  const { session } = useEditorSession();
  const jobs = useSyncExternalStore(
    session.jobs.subscribe,
    session.jobs.getSnapshot,
    session.jobs.getSnapshot,
  );
  const active = jobs.filter((job) => job.status === "queued" || job.status === "running");
  if (!active.length) return null;
  return (
    <div className="editor-job-status" aria-label="Background jobs">
      {active.map((job) => (
        <div key={job.id}>
          <span role="status">
            {job.label} ·{" "}
            {job.status === "queued" ? "Queued" : `${Math.round(job.progress * 100)}%`}
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => session.jobs.cancel(job.id)}
            aria-label={`Cancel ${job.label}`}
          >
            Cancel
          </Button>
        </div>
      ))}
    </div>
  );
}
