/**
 * Browser capture grant for one document and one recording. This is separate from native
 * recorder ownership: it authorizes getUserMedia/getDisplayMedia, not recorder control.
 *
 * awaitingApproval -> approved -> selectingDisplay -> displayGranted
 *                                         \-> displayDenied (one selection per grant)
 * any -> revoked (release, expiry, navigation, destruction)
 */
export type GrantState =
  | { kind: "awaitingApproval"; expires: number }
  | { kind: "approved"; expires: number }
  | { kind: "selectingDisplay"; expires: number }
  | { kind: "displayGranted"; expires: number }
  | { kind: "displayDenied"; expires: number }
  | { kind: "revoked" };

export type GrantEvent =
  | { type: "approve"; expires: number }
  | { type: "beginDisplay" }
  | { type: "displayChosen" }
  | { type: "displayRejected" }
  | { type: "revoke" };

export function grantTransition(state: GrantState, event: GrantEvent): GrantState {
  if (state.kind === "revoked") return state;
  switch (event.type) {
    case "approve":
      return state.kind === "awaitingApproval"
        ? { kind: "approved", expires: event.expires }
        : state;
    case "beginDisplay":
      return state.kind === "approved" ? { ...state, kind: "selectingDisplay" } : state;
    case "displayChosen":
      return state.kind === "selectingDisplay" ? { ...state, kind: "displayGranted" } : state;
    case "displayRejected":
      return state.kind === "selectingDisplay" ? { ...state, kind: "displayDenied" } : state;
    case "revoke":
      return { kind: "revoked" };
  }
}

export const grantExpired = (state: GrantState, now: number) =>
  state.kind === "revoked" || state.expires <= now;
/** Approval has happened; later display states keep the approval. */
export const grantApproved = (state: GrantState) =>
  state.kind === "approved" ||
  state.kind === "selectingDisplay" ||
  state.kind === "displayGranted" ||
  state.kind === "displayDenied";
export const grantDisplayGranted = (state: GrantState) => state.kind === "displayGranted";
