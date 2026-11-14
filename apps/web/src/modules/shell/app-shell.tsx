import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { RiFilmLine, RiFolderVideoLine, RiLiveLine, RiTeamLine } from "@remixicon/react";
import "./shell.css";

const DESTINATIONS = [
  { to: "/studio", label: "Studio", icon: RiLiveLine },
  { to: "/library", label: "Library", icon: RiFolderVideoLine },
  { to: "/", label: "Edit", icon: RiFilmLine },
  { to: "/team", label: "Team", icon: RiTeamLine },
] as const;

/** Every app page shares one dark frame: the rail switches between capture, editing and the team. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-frame">
      <nav className="app-rail" aria-label="App">
        <Link to="/" className="app-rail-brand" aria-label="raE.E home">
          <img src="/brand/mark-white.svg" alt="" width={24} height={24} />
        </Link>
        {DESTINATIONS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="app-rail-link"
            activeOptions={{ exact: true }}
            activeProps={{ "aria-current": "page" }}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className="app-content">{children}</div>
    </div>
  );
}

/** A scrolling page with a title row, used by every route that is not the editor. */
export function AppPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="app-page" aria-label={title}>
      <header className="app-page-header">
        <div>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </main>
  );
}
