export const subscriptionRequiredMessage =
  "This needs a Side Cut subscription on the hosted version. Upgrade in Cloud, or self-host for free.";

// Convex prefixes ConvexError messages with request metadata, so match the server text anywhere in it.
export function isSubscriptionRequired(cause: unknown): boolean {
  return cause instanceof Error && cause.message.includes("Subscription required.");
}

export function cloudErrorMessage(cause: unknown, fallback: string): string {
  if (isSubscriptionRequired(cause)) return subscriptionRequiredMessage;
  return cause instanceof Error ? cause.message : fallback;
}
