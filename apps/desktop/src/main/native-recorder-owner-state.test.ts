import { expect, it } from "vite-plus/test";
import { ownerTransition, OwnerCommandError } from "./native-recorder-owner-state.ts";
import { grantTransition, grantApproved } from "./capture-grant-state.ts";

it("owner: navigation during confirmation or start invalidates without stopping a recording", () => {
  const confirming = { kind: "confirming" } as const;
  expect(ownerTransition(confirming, { type: "invalidate" })).toEqual({
    state: { kind: "invalidating" },
  });
  const late = ownerTransition({ kind: "invalidating" }, { type: "started", id: "a" });
  expect(late.stopLateStart).toBe(true);
  expect(late.state).toEqual({ kind: "invalidating" });
});
it("owner: active invalidation requests exactly one stop, and stop needs an active owner", () => {
  const active = { kind: "active", id: "a" } as const;
  const revoked = ownerTransition(active, { type: "invalidate" });
  expect(revoked).toEqual({ state: { kind: "stopping", id: "a" }, stopRecorder: true });
  expect(ownerTransition(revoked.state!, { type: "invalidate" }).stopRecorder).toBeUndefined();
  expect(() => ownerTransition({ kind: "stopping", id: "a" }, { type: "stop" })).toThrow(
    OwnerCommandError,
  );
  expect(ownerTransition(active, { type: "finished" }).state).toBeUndefined();
});
it("grant: display selection is one-shot and revocation is terminal", () => {
  let state = grantTransition(
    { kind: "awaitingApproval", expires: 1 },
    { type: "approve", expires: 2 },
  );
  expect(grantApproved(state)).toBe(true);
  state = grantTransition(state, { type: "beginDisplay" });
  expect(grantTransition(state, { type: "beginDisplay" })).toBe(state);
  state = grantTransition(state, { type: "displayRejected" });
  expect(state.kind).toBe("displayDenied");
  expect(grantTransition(state, { type: "displayChosen" })).toBe(state);
  expect(grantApproved(state)).toBe(true);
  const revoked = grantTransition(state, { type: "revoke" });
  expect(grantApproved(revoked)).toBe(false);
  expect(grantTransition(revoked, { type: "approve", expires: 3 })).toBe(revoked);
});
