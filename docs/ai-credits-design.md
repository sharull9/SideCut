# AI credits design

Proposed on 2026-11-03. The user confirmed that the product will provide AI usage credits. The rules below are a design proposal, not implemented billing or approved prices.

## Product boundary

Everything is open source and free to self-host. On our hosted version, the video editor is free; the live streaming studio, MCP access, in-app AI, cloud uploads, team sharing and collaborative cloud comments are paid, as defined in [product access](product-access.md). Credits apply only to our hosted AI; self-hosters use their own provider keys.

Provide credits for AI requests fulfilled through our service. Paid MCP access permits a user's chosen AI harness to control the editor and studio. Ordinary MCP commands do not spend AI credits. A command that explicitly starts our hosted AI processing does spend credits, with the same cost preview and limits as the dashboard. Model calls made by a user's own harness are billed by its provider and do not spend our credits.

Proposed packaging: each paid workspace receives an included credit allowance. An individual can have a personal workspace; a team shares one pool. The allowance, renewal period, expiry, rollover, free signup grants and top-ups still need commercial decisions. Do not advertise numeric allowances or grant credits until those rules are configured.

Cloud storage and collaboration do not consume AI credits. Running out of AI credits must not disable paid MCP access, cloud collaboration, the paid studio or the free editor; each follows its own entitlement.

## Dashboard experience

Keep **Usage** in the Cloud navigation. Its page title becomes **Usage and credits** and contains:

- **AI credits:** available balance, credits reserved by running jobs, and the included allowance with its renewal or expiry date when configured. Missing data displays an unavailable state, never a made-up zero or sample balance.
- **Credit activity:** a paginated ledger showing time, action, member, project/job, credits charged or returned, and status. Opening a row shows the related job and charge details.
- **Plan and access:** the active plan and paid access to MCP and cloud collaboration. Show billing controls only when checkout and billing management are connected.
- **Storage:** actual storage usage and limits, separately from AI credits, once metering exists.

The Overview includes a compact credit balance linked to Usage. Show it only for an authenticated workspace with a working balance query. Do not turn the editor or studio into a billing dashboard.

Owners/admins can inspect workspace usage. Members can see their available budget and their own jobs. Viewers cannot start billable processing. Billing changes and credit purchases require the billing owner's permission; team administration alone must not imply permission to spend money.

## Starting an AI action

1. Choose a task and an available model or quality setting.
2. Show the billing workspace, input scope and credit estimate before starting. State whether the amount is fixed or an upper bound.
3. Confirm the maximum credit spend. MCP callers supply the accepted quote and maximum spend explicitly; an automation cannot silently exceed it.
4. Reserve that amount atomically before enqueueing the job. Show reserved credits while it runs.
5. Charge verified billable work and return the unused reservation. The activity row links to the result or explains the failure.

If the balance is insufficient, explain the required and available credits and offer the actions actually supported: reduce the task, choose a cheaper option or ask the billing owner. Show a purchase action only after top-ups are implemented. Never automatically buy credits or switch to a more expensive model.

Cancellation releases unspent credits. A request rejected before provider work incurs no charge. Partial work may be charged only under a disclosed pricing rule with a matching usage record. If a provider times out with an unknown outcome, keep the reservation pending reconciliation rather than charging or retrying blindly.

## Service design

Use the existing Convex team authorization and reservation pattern, but keep feature entitlements separate from the credit wallet.

| Record                | Responsibility                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Workspace entitlement | Paid feature access and validity dates; independent of AI balance.                                                   |
| Credit grant          | Included allowance, purchase, promotion or refund; amount, source, effective/expiry dates and unique external event. |
| Credit ledger entry   | Immutable grant, reservation, charge, release, expiry or adjustment linked to its workspace and job/event.           |
| Job reservation       | Accepted quote, maximum amount, reserved/charged/released totals and reconciliation state.                           |
| Price quote           | Versioned task/model pricing, input estimate, maximum credit cost and expiry.                                        |

Represent credit amounts as bounded integers in a documented smallest unit. Price conversions and rounding happen on the server. Do not expose provider secrets or accept a client-supplied balance, price or payment success as authority.

Reserve/charge/release operations must be transactional and idempotent. Concurrent jobs cannot reserve the same credits. Provider retries, duplicate payment events and worker restarts cannot double-charge or double-grant. Allocate a reservation to specific grants so expiry or renewal cannot invalidate credits already committed to a running job. Reconcile abandoned reservations through a durable worker.

The current `accounts.ts` implementation supplies a useful reservation/checkpoint foundation, but its implicit enabled account with 10,000 units is a fixture-era default, not an approved customer allowance. Its two fixed charge checkpoints are not a general AI price model. Replace these behaviors before launch; never present that default as real purchased or included credits.

Consent, current membership, task permissions, paid entitlement and credit availability are separate checks. Removing a member prevents new work immediately; queued/running work follows the existing consent/cancellation policy with unused credits released. Subscription expiry stops new paid jobs without silently discarding settled results or granting new credits.

## Acceptance

- A free hosted user can edit without credit or subscription checks; the hosted live studio requires a subscription.
- A self-hosted deployment with billing disabled runs every feature without subscription or credit checks.
- Paid MCP commands that do not use our AI spend no credits; explicit hosted AI jobs require a valid quote and spend limit.
- Two concurrent jobs cannot overdraw one workspace balance.
- Duplicate grants, provider callbacks, worker retries and checkpoint resumes cannot duplicate charges.
- Cancelled, rejected and partially completed jobs settle according to the displayed rule; unknown provider outcomes reconcile without blind retries.
- Renewal/expiry preserves active reservations and does not reset history or erase charges.
- Cross-team requests, removed members, viewer requests and unauthorized purchases are rejected on the server.
- Dashboard balances reconcile with the ledger, including pending reservations and returned credits; mobile, keyboard, loading, empty and failure states work.

## Decisions before implementation

Confirm whether credits are included with every paid plan or only selected plans; the allowance and renewal period; expiry/rollover; whether signup grants or top-ups exist; supported AI providers/tasks; credit conversion and rounding; partial-failure charging; and member spending limits. Prices and payments remain unimplemented until those decisions and the payment adapter are in place.
