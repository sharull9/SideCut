import { it, expect } from "vite-plus/test";
import { parseBillingFlag, useSubscription } from "./billing";

it("turns billing on only for the true and 1 flag values", () => {
  expect(parseBillingFlag("true")).toBe(true);
  expect(parseBillingFlag("1")).toBe(true);
  expect(parseBillingFlag("false")).toBe(false);
  expect(parseBillingFlag("0")).toBe(false);
  expect(parseBillingFlag("")).toBe(false);
  expect(parseBillingFlag(undefined)).toBe(false);
});

it("short-circuits to an active self-hosted subscription when billing is off", () => {
  // The flag is unset in tests, so this must return before any Convex hook runs.
  expect(useSubscription()).toEqual({ billingEnabled: false, active: true, loading: false });
  expect(useSubscription("team_1")).toEqual({
    billingEnabled: false,
    active: true,
    loading: false,
  });
});
