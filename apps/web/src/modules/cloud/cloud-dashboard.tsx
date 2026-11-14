import { Component, Suspense, lazy, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@sidecut/ui/components/sidebar";
import {
  RiArrowLeftLine,
  RiArrowRightSLine,
  RiArrowRightUpLine,
  RiFilmLine,
  RiFolderVideoLine,
  RiGroupLine,
  RiLiveLine,
} from "@remixicon/react";
import { CloudContent } from "./cloud-content";
import { browserCloudConfig } from "./config";
import { useCloud } from "./cloud-context";
import { cloudSections, type Section } from "./cloud-sections";
import "./cloud-dashboard.css";

const descriptions: Record<Section, string> = {
  overview: "Your team, shared media and cloud workflows, together.",
  library: "Find and organize the media shared with your team.",
  team: "Manage your account, teammates and invitations.",
  reviews: "Keep feedback connected to the right version.",
  publishing: "Prepare content and manage its destinations.",
  usage: "Understand your plan, storage and processing usage.",
};

const upcoming = {
  reviews: [
    ["Versioned playback", "Hosted video playback and thumbnails are not available yet."],
    [
      "Share links and guest feedback",
      "Guest review pages and sharing controls are not available yet.",
    ],
  ],
  publishing: [
    ["AI-assisted edits", "Cloud processing, transcripts and derived edits are not available yet."],
    ["Connected accounts", "Provider sign-in and account management are not available yet."],
    ["Scheduled publishing", "Publishing and scheduling controls are not available yet."],
  ],
  usage: [
    ["Plan and billing", "Checkout and subscription management are not available yet."],
    ["Storage and processing", "Usage totals and storage billing are not available yet."],
    ["Account data", "Account export and deletion controls are not available yet."],
  ],
} satisfies Record<"reviews" | "publishing" | "usage", string[][]>;

export type UpcomingSection = keyof typeof upcoming;

function useConfigured() {
  const [configured] = useState(() => browserCloudConfig() !== null);
  return configured;
}

const SidebarTeam = lazy(() => import("./sidebar-team"));

// The "Create" group: destinations outside the cloud workspace.
const appLinks = [
  { to: "/studio", label: "Studio", icon: RiLiveLine },
  { to: "/", label: "Editor", icon: RiFilmLine },
] as const;

function sectionLabel(section: Section) {
  return cloudSections.find((item) => item.id === section)?.label ?? "Overview";
}

/** Persistent frame: shadcn sidebar on the left, the active cloud page on the right. */
export function CloudLayout({ children }: { children: ReactNode }) {
  const configured = useConfigured();
  return (
    <SidebarProvider className="dark cloud-dashboard">
      <a className="cloud-skip" href="#cloud-main">
        Skip to content
      </a>
      <CloudSidebar />
      <SidebarInset className="cloud-body">
        <header className="cloud-topbar">
          <div className="cloud-topbar-title">
            <SidebarTrigger aria-label="Toggle navigation" />
            <CloudBreadcrumb />
          </div>
          <span className="cloud-connection">
            {configured ? "Cloud enabled" : "Cloud not configured"}
          </span>
        </header>
        <main id="cloud-main" className="cloud-main" tabIndex={-1}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function useCurrentSection() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const path = pathname.replace(/\/+$/, "") || "/";
  return (
    cloudSections.find((item) => item.to !== "/cloud" && path.startsWith(item.to)) ??
    cloudSections[0]
  );
}

function CloudBreadcrumb() {
  const section = useCurrentSection();
  return (
    <nav aria-label="Breadcrumb">
      <ol className="cloud-breadcrumb">
        <li>
          <Link to="/cloud" activeOptions={{ exact: true }}>
            Cloud
          </Link>
        </li>
        <li aria-hidden="true">
          <RiArrowRightSLine size={16} />
        </li>
        <li>
          <span aria-current="page">{section.label}</span>
        </li>
      </ol>
    </nav>
  );
}

function CloudSidebar() {
  const current = useCurrentSection();
  const { configured } = useCloud();
  const { setOpenMobile } = useSidebar();
  const closeMobile = () => setOpenMobile(false);

  return (
    <Sidebar className="dark cloud-sidebar">
      <SidebarHeader className="cloud-sidebar-header">
        <Link to="/" className="cloud-brand" aria-label="raE.E home" onClick={closeMobile}>
          <img src="/brand/mark-white.svg" alt="" width={28} height={28} />
          <span>raE.E</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Main navigation">
          <SidebarGroup>
            <SidebarGroupLabel>Create</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {appLinks.map(({ to, label, icon: Icon }) => (
                  <SidebarMenuItem key={to}>
                    <SidebarMenuButton render={<Link to={to} onClick={closeMobile} />}>
                      <Icon aria-hidden="true" />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Cloud</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {cloudSections.map(({ id, to, label, icon: Icon }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      isActive={current.id === id}
                      render={
                        <Link
                          to={to}
                          // Without exact matching, /cloud would also count as active on every subpage.
                          activeOptions={{ exact: true }}
                          onClick={closeMobile}
                        />
                      }
                    >
                      <Icon aria-hidden="true" />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="cloud-sidebar-footer">
        {configured ? (
          <SidebarTeamBoundary onNavigate={closeMobile}>
            <Suspense fallback={<StaticTeamLink onNavigate={closeMobile} />}>
              <SidebarTeam onNavigate={closeMobile} />
            </Suspense>
          </SidebarTeamBoundary>
        ) : (
          <StaticTeamLink onNavigate={closeMobile} />
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

/** Team link without live data: used before cloud is set up, while loading, or if loading fails. */
function StaticTeamLink({ onNavigate }: { onNavigate(): void }) {
  return (
    <Link to="/cloud/team" className="cloud-team-link" onClick={onNavigate}>
      <span className="cloud-team-avatar" aria-hidden="true">
        <RiGroupLine size={14} />
      </span>
      <span className="cloud-team-text">
        <span className="cloud-team-name">Team</span>
        <span className="cloud-team-detail">Account and team</span>
      </span>
    </Link>
  );
}

// A failed team query should not take the whole sidebar down with it.
class SidebarTeamBoundary extends Component<
  { onNavigate(): void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <StaticTeamLink onNavigate={this.props.onNavigate} />
    ) : (
      this.props.children
    );
  }
}

function PageHeading({ section }: { section: Section }) {
  return (
    <div className="cloud-page-heading">
      <h1>{sectionLabel(section)}</h1>
      <p>{descriptions[section]}</p>
    </div>
  );
}

export function CloudOverviewPage() {
  const configured = useConfigured();
  return (
    <>
      <PageHeading section="overview" />
      <section className="cloud-start" aria-labelledby="cloud-start-title">
        <div>
          <RiFolderVideoLine aria-hidden="true" size={32} />
          <h2 id="cloud-start-title">Make room for your next project.</h2>
          <p>
            Organize shared media, choose your team and bring collaborators into the same workspace.
          </p>
          <Link to="/cloud/library" className="cloud-primary-link">
            Open library <RiArrowRightUpLine size={18} aria-hidden="true" />
          </Link>
        </div>
        <div className="cloud-start-note">
          <h3>{configured ? "Connect your team" : "Cloud access is not set up"}</h3>
          <p>
            {configured
              ? "Open Team to sign in, choose a workspace or accept an invitation."
              : "Team and library access will be available when cloud services are configured for this app."}
          </p>
          <Link to="/cloud/team">
            Account and team <RiArrowRightUpLine size={16} aria-hidden="true" />
          </Link>
        </div>
      </section>
      <section className="cloud-workflows" aria-labelledby="cloud-workflows-title">
        <h2 id="cloud-workflows-title">Cloud workflows</h2>
        <div className="cloud-workflow-list">
          {cloudSections
            .filter((item) => item.id !== "overview")
            .map(({ id, to, label, icon: Icon }) => (
              <Link key={id} to={to} className="cloud-workflow-row">
                <Icon size={21} aria-hidden="true" />
                <div>
                  <h3>{label}</h3>
                  <p>{descriptions[id]}</p>
                </div>
                <span className="cloud-status">
                  {id === "team" || id === "library"
                    ? configured
                      ? "Available"
                      : "Setup required"
                    : "Coming soon"}
                </span>
                <RiArrowRightUpLine size={18} aria-hidden="true" />
              </Link>
            ))}
        </div>
      </section>
    </>
  );
}

export function CloudConnectedPage({ section }: { section: "team" | "library" }) {
  return (
    <>
      <PageHeading section={section} />
      <section
        className="cloud-connected-panel"
        aria-label={section === "team" ? "Account and team" : "Team library"}
      >
        <CloudContent view={section} />
      </section>
    </>
  );
}

export function CloudUpcomingPage({ section }: { section: UpcomingSection }) {
  const title = sectionLabel(section);
  return (
    <>
      <PageHeading section={section} />
      <section className="cloud-upcoming" aria-label={`${title} availability`}>
        <span className="cloud-status">Coming soon</span>
        <h2>{title} tools are not available yet</h2>
        <p>This area will bring these tools into your cloud workspace.</p>
        <dl>
          {upcoming[section].map(([label, description]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
        <Link to="/" className="cloud-editor-link">
          <RiArrowLeftLine size={16} aria-hidden="true" /> Continue editing
        </Link>
      </section>
    </>
  );
}
