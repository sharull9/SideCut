import { describe, expect, it } from "vite-plus/test";
import { defineTestApp } from "convex-test";
import schema from "./schema";
import * as teams from "./teams";

const { api, createTest } = defineTestApp({ schema }).defineModules({ teams });
const alice = {
  subject: "alice",
  issuer: "https://api.workos.com/",
  email: "alice@example.com",
  emailVerified: true,
};
const bob = {
  subject: "bob",
  issuer: "https://api.workos.com/",
  email: "bob@example.com",
  emailVerified: true,
};

describe("cloud team authorization", () => {
  it("requires authentication and isolates tenant reads and writes", async () => {
    const t = createTest();
    await expect(t.mutation(api.teams.create, { name: "A" })).rejects.toThrow("Sign in");
    const a = t.withIdentity(alice);
    const b = t.withIdentity(bob);
    const teamId = await a.mutation(api.teams.create, { name: "A" });
    await b.mutation(api.teams.create, { name: "B" });
    expect(await a.query(api.teams.list)).toHaveLength(1);
    await expect(b.query(api.teams.members, { teamId })).rejects.toThrow("access denied");
    await expect(b.query(api.teams.invitations, { teamId })).rejects.toThrow("access denied");
    await expect(
      b.mutation(api.teams.invite, { teamId, email: "x@example.com", role: "member" }),
    ).rejects.toThrow("access denied");
  });

  it("binds invitations to verified email and rejects replay", async () => {
    const t = createTest();
    const a = t.withIdentity(alice);
    const b = t.withIdentity(bob);
    const teamId = await a.mutation(api.teams.create, { name: "A" });
    const invitationId = await a.mutation(api.teams.invite, {
      teamId,
      email: "BOB@example.com",
      role: "viewer",
    });
    await expect(a.mutation(api.teams.accept, { invitationId })).rejects.toThrow("unavailable");
    await expect(
      t.withIdentity({ ...bob, emailVerified: false }).mutation(api.teams.accept, { invitationId }),
    ).rejects.toThrow("unavailable");
    expect(await b.query(api.teams.pendingInvitations)).toHaveLength(1);
    await b.mutation(api.teams.accept, { invitationId });
    expect((await b.query(api.teams.list))[0]?.role).toBe("viewer");
    await expect(b.query(api.teams.invitations, { teamId })).rejects.toThrow("administrator");
    await expect(b.mutation(api.teams.accept, { invitationId })).rejects.toThrow("unavailable");
    await expect(
      b.mutation(api.teams.invite, { teamId, email: "x@example.com", role: "member" }),
    ).rejects.toThrow("administrator");
  });

  it("rejects expired and revoked invitations", async () => {
    const t = createTest();
    const a = t.withIdentity(alice);
    const b = t.withIdentity(bob);
    const teamId = await a.mutation(api.teams.create, { name: "A" });
    const invitationId = await a.mutation(api.teams.invite, {
      teamId,
      email: bob.email,
      role: "member",
    });
    await expect(
      a.mutation(api.teams.invite, { teamId, email: bob.email, role: "viewer" }),
    ).rejects.toThrow("already pending");
    await t.run((ctx) => ctx.db.patch(invitationId, { expiresAt: 0 }));
    await expect(b.mutation(api.teams.accept, { invitationId })).rejects.toThrow("unavailable");
    const second = await a.mutation(api.teams.invite, { teamId, email: bob.email, role: "member" });
    await a.mutation(api.teams.revokeInvitation, { invitationId: second });
    await expect(b.mutation(api.teams.accept, { invitationId: second })).rejects.toThrow(
      "unavailable",
    );
  });

  it("prevents escalation and preserves the last owner", async () => {
    const t = createTest();
    const a = t.withIdentity(alice);
    const b = t.withIdentity(bob);
    const teamId = await a.mutation(api.teams.create, { name: "A" });
    const owner = (await a.query(api.teams.members, { teamId }))[0];
    if (!owner) throw new Error("Missing owner");
    await expect(
      a.mutation(api.teams.setRole, { membershipId: owner._id, role: "member" }),
    ).rejects.toThrow("retain an owner");
    await expect(a.mutation(api.teams.removeMember, { membershipId: owner._id })).rejects.toThrow(
      "demote owners",
    );
    const invitationId = await a.mutation(api.teams.invite, {
      teamId,
      email: bob.email,
      role: "admin",
    });
    await b.mutation(api.teams.accept, { invitationId });
    await expect(
      b.mutation(api.teams.setRole, { membershipId: owner._id, role: "viewer" }),
    ).rejects.toThrow("Only owners");
    await expect(
      b.mutation(api.teams.invite, { teamId, email: "x@example.com", role: "admin" }),
    ).rejects.toThrow("Only owners");
    const admin = (await a.query(api.teams.members, { teamId })).find((m) => m.role === "admin");
    if (!admin) throw new Error("Missing admin");
    await a.mutation(api.teams.removeMember, { membershipId: admin._id });
    await expect(b.query(api.teams.members, { teamId })).rejects.toThrow("access denied");
  });

  it("rejects invitations after their issuer loses permission", async () => {
    const t = createTest();
    const a = t.withIdentity(alice);
    const b = t.withIdentity(bob);
    const teamId = await a.mutation(api.teams.create, { name: "A" });
    const adminInvite = await a.mutation(api.teams.invite, {
      teamId,
      email: bob.email,
      role: "admin",
    });
    await b.mutation(api.teams.accept, { invitationId: adminInvite });
    const invitationId = await b.mutation(api.teams.invite, {
      teamId,
      email: "carol@example.com",
      role: "member",
    });
    const admin = (await a.query(api.teams.members, { teamId })).find((m) => m.role === "admin");
    if (!admin) throw new Error("Missing admin");
    await a.mutation(api.teams.setRole, { membershipId: admin._id, role: "viewer" });
    await expect(
      t
        .withIdentity({ subject: "carol", email: "carol@example.com", emailVerified: true })
        .mutation(api.teams.accept, { invitationId }),
    ).rejects.toThrow("unavailable");
  });
});
