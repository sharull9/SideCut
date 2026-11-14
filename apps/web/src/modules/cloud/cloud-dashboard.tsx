import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  RiArrowLeftLine,
  RiArrowRightUpLine,
  RiCloudLine,
  RiFolderVideoLine,
} from "@remixicon/react";
import { CloudContent } from "./cloud-content";
import { browserCloudConfig } from "./config";
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

export function CloudDashboard({ section }: { section: Section }) {
  const [configured] = useState(() => browserCloudConfig() !== null);
  const title = cloudSections.find((item) => item.id === section)?.label ?? "Overview";
  return (
    <div className="dark cloud-dashboard">
      <a className="cloud-skip" href="#cloud-main">
        Skip to content
      </a>
      <aside className="cloud-sidebar">
        <Link
          to="/cloud"
          search={{ section: "overview" }}
          className="cloud-brand"
          aria-label="raE.E Cloud dashboard"
        >
          <RiCloudLine aria-hidden="true" size={24} />
          <span>
            raE.E <span className="cloud-brand-label">Cloud</span>
          </span>
        </Link>
        <nav aria-label="Cloud navigation" className="cloud-navigation">
          {cloudSections.map(({ id, label, icon: Icon }) => (
            <Link
              key={id}
              to="/cloud"
              search={{ section: id }}
              aria-current={section === id ? "page" : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="cloud-sidebar-footer">
          <p>One workspace for the work you share.</p>
          <Link to="/" className="cloud-editor-link">
            <RiArrowLeftLine size={16} aria-hidden="true" /> Back to editor
          </Link>
          <Link to="/studio" className="cloud-editor-link">
            Open studio <RiArrowRightUpLine size={16} aria-hidden="true" />
          </Link>
        </div>
      </aside>
      <div className="cloud-body">
        <header className="cloud-topbar">
          <span>Cloud workspace</span>
          <span className="cloud-connection">
            {configured ? "Cloud enabled" : "Cloud not configured"}
          </span>
        </header>
        <main id="cloud-main" className="cloud-main" tabIndex={-1}>
          <div className="cloud-page-heading">
            <h1>{title}</h1>
            <p>{descriptions[section]}</p>
          </div>
          {section === "overview" ? (
            <>
              <section className="cloud-start" aria-labelledby="cloud-start-title">
                <div>
                  <RiFolderVideoLine aria-hidden="true" size={32} />
                  <h2 id="cloud-start-title">Make room for your next project.</h2>
                  <p>
                    Organize shared media, choose your team and bring collaborators into the same
                    workspace.
                  </p>
                  <Link to="/cloud" search={{ section: "library" }} className="cloud-primary-link">
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
                  <Link to="/cloud" search={{ section: "team" }}>
                    Account and team <RiArrowRightUpLine size={16} aria-hidden="true" />
                  </Link>
                </div>
              </section>
              <section className="cloud-workflows" aria-labelledby="cloud-workflows-title">
                <h2 id="cloud-workflows-title">Cloud workflows</h2>
                <div className="cloud-workflow-list">
                  {cloudSections
                    .filter((item) => item.id !== "overview")
                    .map(({ id, label, icon: Icon }) => (
                      <Link
                        key={id}
                        to="/cloud"
                        search={{ section: id }}
                        className="cloud-workflow-row"
                      >
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
          ) : section === "team" || section === "library" ? (
            <section
              className="cloud-connected-panel"
              aria-label={section === "team" ? "Account and team" : "Team library"}
            >
              <CloudContent view={section} />
            </section>
          ) : (
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
          )}
        </main>
      </div>
    </div>
  );
}
