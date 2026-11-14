import { Link } from "@tanstack/react-router";
import { useActiveTeam } from "./active-team";

// Loaded only when cloud is configured, so the Convex hooks in useActiveTeam always have providers.
export default function SidebarTeam({ onNavigate }: { onNavigate(): void }) {
  const { isLoading, isAuthenticated, current } = useActiveTeam();
  const name = isLoading
    ? "Loading team…"
    : !isAuthenticated
      ? "Sign in"
      : (current?.team.name ?? "Choose a team");
  const detail =
    isAuthenticated && current
      ? current.role.charAt(0).toUpperCase() + current.role.slice(1)
      : "Account and team";
  return (
    <Link to="/cloud/team" className="cloud-team-link" onClick={onNavigate}>
      <span className="cloud-team-avatar" aria-hidden="true">
        {current ? current.team.name.charAt(0).toUpperCase() : "?"}
      </span>
      <span className="cloud-team-text">
        <span className="cloud-team-name">{name}</span>
        <span className="cloud-team-detail">{detail}</span>
      </span>
    </Link>
  );
}
