// Dependency-free: imported by the main bundle, so it must not pull in Convex or AuthKit.

// Only the hosted build turns billing on. Self-hosted and unset builds allow everything.
export function parseBillingFlag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function billingEnabledAtBuild(): boolean {
  try {
    return parseBillingFlag(import.meta.env.VITE_SIDECUT_BILLING_ENABLED);
  } catch {
    return false;
  }
}
