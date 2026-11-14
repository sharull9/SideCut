import { useState } from "react";
import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { api } from "@sidecut/cloud/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@sidecut/ui/components/button";
import { Input } from "@sidecut/ui/components/input";
import { useCloud } from "./cloud-provider";
import { useActiveTeamId } from "./active-team";
import { CloudLibrary } from "./library-panel";

type Team = NonNullable<FunctionReturnType<typeof api.teams.list>[number]["team"]>;
const roles = ["owner", "admin", "member", "viewer"] as const;

export default function CloudTeams() {
  const { configured } = useCloud();
  if (!configured)
    return <p>Cloud teams are not configured for this app. You can keep editing locally.</p>;
  return <Account />;
}

function Account() {
  const { user, signIn, signOut } = useAuth();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [error, setError] = useState("");
  if (isLoading) return <p role="status">Connecting your account…</p>;
  if (!isAuthenticated)
    return (
      <div className="grid gap-3">
        <p>Sign in to create a team or accept an invitation.</p>
        {error && <p role="alert">{error}</p>}
        <Button
          onClick={() => {
            void signIn().catch(() => setError("Sign-in could not start. Try again."));
          }}
        >
          Sign in
        </Button>
      </div>
    );
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate">{user?.email}</span>
        <Button
          variant="outline"
          onClick={() => {
            try {
              signOut();
            } catch {
              setError("Sign-out failed. Try again.");
            }
          }}
        >
          Sign out
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      <TeamManager />
    </div>
  );
}

function TeamManager() {
  const teams = useQuery(api.teams.list);
  const invitations = useQuery(api.teams.pendingInvitations);
  const create = useMutation(api.teams.create);
  const accept = useMutation(api.teams.accept);
  const [selected, setSelected] = useActiveTeamId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = teams?.find((entry) => entry.team?._id === selected) ?? teams?.[0];
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Team update failed.");
    } finally {
      setBusy(false);
    }
  }
  if (!teams || !invitations) return <p role="status">Loading your teams…</p>;
  return (
    <div className="grid gap-5">
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {invitations.length > 0 && (
        <section aria-label="Your invitations" className="grid gap-2">
          <h3 className="font-medium">Your invitations</h3>
          {invitations.map((invitation) => (
            <div key={invitation._id} className="flex items-center justify-between gap-3">
              <span>Invitation as {invitation.role}</span>
              <Button
                disabled={busy}
                onClick={() => {
                  void run(async () => setSelected(await accept({ invitationId: invitation._id })));
                }}
              >
                Accept
              </Button>
            </div>
          ))}
        </section>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const name = new FormData(form).get("name");
          if (typeof name === "string")
            void run(async () => {
              setSelected(await create({ name }));
              form.reset();
            });
        }}
      >
        <label className="grid min-w-0 flex-1 gap-1">
          New team
          <Input name="name" required maxLength={100} placeholder="Team name" />
        </label>
        <Button type="submit" disabled={busy}>
          Create
        </Button>
      </form>
      {teams.length === 0 && (
        <p>No teams yet. Create a team or ask its owner to invite your sign-in email.</p>
      )}
      {teams.length > 0 && (
        <label className="grid gap-1">
          Active team
          <select
            className="h-9 rounded-md border bg-background px-2"
            value={current?.team?._id ?? ""}
            onChange={(event) => {
              const team = teams.find((entry) => entry.team?._id === event.target.value)?.team;
              if (team) setSelected(team._id);
            }}
          >
            {teams.map(
              (entry) =>
                entry.team && (
                  <option key={entry.team._id} value={entry.team._id}>
                    {entry.team.name} ({entry.role})
                  </option>
                ),
            )}
          </select>
        </label>
      )}
      {current?.team && (
        <>
          <TeamDetails key={current.team._id} team={current.team} role={current.role} />
          <CloudLibrary
            key={current.team._id}
            teamId={current.team._id}
            readOnly={current.role === "viewer"}
          />
        </>
      )}
      <p className="text-xs text-muted-foreground">
        The active team is where Studio saves cloud takes. Selecting a team does not upload or move
        your local project.
      </p>
    </div>
  );
}

function TeamDetails({ team, role }: { team: Team; role: string }) {
  const canManage = role === "owner" || role === "admin";
  const members = useQuery(api.teams.members, { teamId: team._id });
  const invitations = useQuery(api.teams.invitations, canManage ? { teamId: team._id } : "skip");
  const invite = useMutation(api.teams.invite),
    revoke = useMutation(api.teams.revokeInvitation),
    changeRole = useMutation(api.teams.setRole),
    remove = useMutation(api.teams.removeMember);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Team update failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="grid gap-4" aria-label={`${team.name} members`}>
      <h3 className="font-medium">Members</h3>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {!members ? (
        <p role="status">Loading members…</p>
      ) : (
        <ul className="grid gap-2">
          {members.map((member) => (
            <li key={member._id} className="flex flex-wrap items-center gap-2 border-b pb-2">
              <span className="min-w-0 flex-1 break-all text-xs">
                {member.user.split("|").at(-1)}
              </span>
              {role === "owner" ? (
                <select
                  aria-label={`Role for ${member.user}`}
                  className="h-9 rounded-md border bg-background px-2"
                  value={member.role}
                  disabled={busy}
                  onChange={(event) => {
                    const next = roles.find((value) => value === event.target.value);
                    if (next) void run(() => changeRole({ membershipId: member._id, role: next }));
                  }}
                >
                  {roles.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              ) : (
                <span>{member.role}</span>
              )}
              {canManage &&
                member.role !== "owner" &&
                (role === "owner" || member.role !== "admin") && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Remove this member from the team?"))
                        void run(() => remove({ membershipId: member._id }));
                    }}
                  >
                    Remove
                  </Button>
                )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget,
                data = new FormData(form);
              const email = data.get("email"),
                next = roles.find((value) => value === data.get("role"));
              if (typeof email === "string" && next && next !== "owner")
                void run(async () => {
                  await invite({ teamId: team._id, email, role: next });
                  form.reset();
                });
            }}
          >
            <h3 className="font-medium">Invite a teammate</h3>
            <label className="grid gap-1">
              Email
              <Input name="email" type="email" required maxLength={254} />
            </label>
            <label className="grid gap-1">
              Role
              <select
                name="role"
                className="h-9 rounded-md border bg-background px-2"
                defaultValue="member"
              >
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
                {role === "owner" && <option value="admin">Admin</option>}
              </select>
            </label>
            <Button type="submit" disabled={busy}>
              Create invitation
            </Button>
            <p className="text-xs text-muted-foreground">
              They can accept in Teams after signing in with this verified email. No email is sent.
            </p>
          </form>
          <ul className="grid gap-2" aria-label="Sent invitations">
            {invitations
              ?.filter((item) => item.status === "pending")
              .map((item) => (
                <li key={item._id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 break-all">
                    {item.email} · {item.role}
                  </span>
                  <Button
                    variant="outline"
                    disabled={busy || (item.role === "admin" && role !== "owner")}
                    onClick={() => {
                      void run(() => revoke({ invitationId: item._id }));
                    }}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
          </ul>
        </>
      )}
    </section>
  );
}
