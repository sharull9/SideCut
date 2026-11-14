import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@sidecut/ui/components/button";
import { AppPage } from "@/modules/shell/app-shell";
import { useActiveTeam } from "./active-team";
import { useCloud } from "./cloud-provider";
import { CloudLibrary } from "./library-panel";

export function LibraryPage() {
  const { configured } = useCloud();
  return (
    <AppPage title="Library" description="Your team's cloud files. Open any of them in the editor.">
      {configured ? (
        <TeamLibrary />
      ) : (
        <p>Cloud is not configured for this app. Studio takes stay on this device.</p>
      )}
    </AppPage>
  );
}

function TeamLibrary() {
  const { isLoading, isAuthenticated, teams, current, select } = useActiveTeam();
  if (isLoading || (isAuthenticated && !teams)) return <p role="status">Loading your library…</p>;
  if (!isAuthenticated || !current)
    return (
      <div className="grid justify-items-start gap-3">
        <p>
          {isAuthenticated
            ? "Create or join a team to get a cloud library."
            : "Sign in to see your team's library."}
        </p>
        <Link to="/team" className={buttonVariants({ size: "sm" })}>
          Go to Team
        </Link>
      </div>
    );
  return (
    <div className="grid gap-4">
      {teams && teams.length > 1 && (
        <label className="grid max-w-sm gap-1">
          Team
          <select value={current.team._id} onChange={(event) => select(event.target.value)}>
            {teams.map((entry) => (
              <option key={entry.team._id} value={entry.team._id}>
                {entry.team.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <CloudLibrary
        key={current.team._id}
        teamId={current.team._id}
        readOnly={current.role === "viewer"}
      />
    </div>
  );
}
