import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@sidecut/ui/components/button";
import { billingActive, useSubscription } from "./billing";

export function SubscriptionGate({
  feature,
  teamId,
  children,
}: {
  feature: string;
  teamId?: string | undefined;
  children: ReactNode;
}) {
  if (!billingActive()) return <>{children}</>;
  return (
    <GateContent feature={feature} teamId={teamId}>
      {children}
    </GateContent>
  );
}

function GateContent({
  feature,
  teamId,
  children,
}: {
  feature: string;
  teamId?: string | undefined;
  children: ReactNode;
}) {
  const subscription = useSubscription(teamId);
  if (subscription.loading) return <p role="status">Checking your subscription…</p>;
  if (subscription.active) return <>{children}</>;
  return <SubscriptionPaywall feature={feature} />;
}

export function SubscriptionPaywall({ feature }: { feature: string }) {
  return (
    <section
      aria-labelledby="subscription-paywall-title"
      className="grid max-w-xl gap-3 rounded-lg border border-border p-6"
    >
      <h2 id="subscription-paywall-title" className="text-lg font-semibold">
        {feature}
      </h2>
      <p>Requires a Side Cut subscription on our hosted version.</p>
      <p>Self-hosting is free — the project is open source.</p>
      <div>
        <Link to="/cloud" className={buttonVariants()}>
          Upgrade in Cloud
        </Link>
      </div>
    </section>
  );
}
