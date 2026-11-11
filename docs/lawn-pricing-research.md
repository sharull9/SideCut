# Lawn pricing research and tentative Side Cut packaging

Researched 2026-11-03 (Asia/Calcutta). USD, monthly unless stated. Findings below are verified observations; recommendations are proposals, not approved prices or implemented billing.

## Verified Lawn findings

The official origin is `https://lawn.video`, identified in [pinned SEO source](https://github.com/pingdotgg/lawn/blob/9163eac92bbc5c4cd24eec83f63541ce20f17477/src/lib/seo.ts#L1). A direct HTTP GET of [the live pricing page](https://lawn.video/pricing) returned **200 OK**, without an access challenge, and its returned HTML confirmed:

- **Basic: $5/month, 100GB storage.** Unlimited seats, projects and clients.
- **Pro: $25/month, 1TB storage.** The same features with more space; unlimited seats, projects and clients.
- No per-user fees. The FAQ explicitly includes editors, producers and clients at no extra charge.
- Guests can follow a share link, watch and comment without an account. The page also advertises a trial without a credit card; its duration was not established by this live-page check.

These claims match the cached repository at clean commit `9163eac92bbc5c4cd24eec83f63541ce20f17477`: [Basic](https://github.com/pingdotgg/lawn/blob/9163eac92bbc5c4cd24eec83f63541ce20f17477/app/routes/-pricing.tsx#L23-L54), [Pro](https://github.com/pingdotgg/lawn/blob/9163eac92bbc5c4cd24eec83f63541ce20f17477/app/routes/-pricing.tsx#L58-L94), [guest/seat FAQ](https://github.com/pingdotgg/lawn/blob/9163eac92bbc5c4cd24eec83f63541ce20f17477/app/routes/-pricing.tsx#L109-L124), and [route metadata](https://github.com/pingdotgg/lawn/blob/9163eac92bbc5c4cd24eec83f63541ce20f17477/app/routes/pricing.tsx#L5-L12).

Backend evidence adds useful qualifications:

- [Billing constants](https://github.com/pingdotgg/lawn/blob/9163eac92bbc5c4cd24eec83f63541ce20f17477/convex/billingHelpers.ts#L6-L18) also specify $5/$25. Actual byte limits are `100 * 1024^3` (100 GiB; 107,374,182,400 bytes) and `1024 * 1024^3` (1 TiB; 1,099,511,627,776 bytes). Marketing labels say GB/TB.
- [Storage accounting](https://github.com/pingdotgg/lawn/blob/9163eac92bbc5c4cd24eec83f63541ce20f17477/convex/billingHelpers.ts#L79-L105) sums finite video `fileSize` values across the team's projects, excluding failed videos. This is application quota accounting, not proof of the provider's total stored bytes or costs.
- [Upload checks](https://github.com/pingdotgg/lawn/blob/9163eac92bbc5c4cd24eec83f63541ce20f17477/convex/billingHelpers.ts#L107-L132) require an eligible subscription and reject a request exceeding the plan's storage limit. The [status helper](https://github.com/pingdotgg/lawn/blob/9163eac92bbc5c4cd24eec83f63541ce20f17477/convex/billingHelpers.ts#L51-L53) accepts `active`, `trialing` and `past_due`; “active” here includes delinquent subscriptions.
- [Checkout](https://github.com/pingdotgg/lawn/blob/9163eac92bbc5c4cd24eec83f63541ce20f17477/convex/billing.ts#L124-L142) creates one subscription line item with quantity `1` and team metadata, consistent with team billing rather than seat multiplication. Actual Stripe dashboard configuration was not inspected.

Lawn is a video review/collaboration benchmark. These sources do not establish comparable MCP or hosted AI allowances, nor Lawn's realized margins or willingness to pay for Side Cut.

## Verified Cloudflare R2 rates and storage arithmetic

The official [R2 pricing documentation](https://developers.cloudflare.com/r2/pricing/) and its [Markdown version](https://developers.cloudflare.com/r2/pricing/index.md) were successfully fetched. The page reports an update date of 2026-10-30.

For **Standard** storage, published rates are **$0.015/GB-month**, **$4.50/million Class A requests** (including writes/listing/multipart operations), and **$0.36/million Class B requests** (including reads/HEAD). Direct R2 internet egress is free; other connected metered services can charge separately. The monthly free tier is 10 GB-month, 1 million Class A and 10 million Class B requests, shared at the provider account level rather than granted anew to each Side Cut workspace. [Rates](https://developers.cloudflare.com/r2/pricing/#r2-pricing), [free tier](https://developers.cloudflare.com/r2/pricing/#free-tier), [operation definitions](https://developers.cloudflare.com/r2/pricing/#class-a-operations).

At the published GB-month rate, constant storage of **100 billing GB for a month costs $1.50**, and **1,000 billing GB (decimal 1TB) costs $15.00**, before requests and without allocating free tier. For a scenario of **1,024 billing GB**, it is **$15.36**. If the account's entire 10 GB-month free allowance were available, those figures become $1.35, $14.85 and $15.21. Do not build per-workspace economics around that shared allowance.

These are raw object-storage calculations, not an exact byte-to-invoice reconstruction of Lawn's binary quotas. The fetched R2 pricing page labels units GB; it does not resolve the byte convention used in these quota comparisons. Specify Side Cut's byte convention explicitly before launch and reconcile it against provider metering. R2 averages daily peak storage over the billing period and rounds billable usage up to its billing units. [Storage measurement](https://developers.cloudflare.com/r2/pricing/#storage-usage), [rounding](https://developers.cloudflare.com/r2/pricing/#r2-pricing).

The estimates exclude request charges, additional stored versions/derivatives/backups, transcoding, playback services, databases, compute, AI, payment fees, support and taxes. Versions and derived objects add storage if retained; a 100GB user-upload allowance need not mean only 100GB of physical storage. No claim is made that Lawn uses R2 or pays these costs. R2 Infrequent Access is not the default recommendation for active review: it adds retrieval charges and a 30-day minimum storage duration. [Retrieval/minimum duration](https://developers.cloudflare.com/r2/pricing/#data-retrieval).

## Tentative Side Cut recommendation

Preserve the confirmed [product access policy](product-access.md): the whole product is open source and free to self-host; these prices apply only to our hosted version. On it, the video editor is free; live studio, MCP, cloud uploads, team sharing and collaborative cloud comments paid; provide included AI credits. The existing [AI credits design](ai-credits-design.md) remains a proposal. These local documents record intended policy, not evidence that payments or all entitlement checks already work.

Test **$15 per workspace/month including one billable editor seat**, then **$3 per additional billable editor/admin/member** (owner-approved 2026-11-11, reduced from an initial $5 proposal). Count the owner within the included seat; count each accepted user with creation/upload/team-management permissions once per workspace. Role names should map to actual capabilities. Propose billing accepted memberships rather than pending invitations, with role upgrades shown to the billing owner before a charge.

Solo costs **$15/month**; three total billable people cost **$21/month**; five cost **$27/month**; ten cost **$42/month**. Formula: `15 + 3 * max(0, billable_people - 1)`. Seats add no storage or AI allowance, so their marginal cost is mostly accounts, database rows and support; $3 keeps the per-seat charge light while still discouraging account sharing. Payment-processor fixed fees apply per invoice, not per seat, so a low seat price does not multiply them. Include **100GB pooled workspace storage**, independent of seat count: adding seats does not add storage or AI allowance by default.

Guests/viewers may watch, comment and reply free of seat charges under a paid workspace. This keeps collaborative comments a paid feature purchased by the workspace owner; reviewers do not each need a subscription. Guests/viewers should not gain upload, editing, team administration or hosted AI spending rights. Accountless guest commenting is a separate authorization/product decision; Lawn demonstrates the model, but Side Cut has not confirmed it.

Even at $3/seat, the model charges more than Lawn for collaboration alone, so validate whether the paid studio, MCP and AI workflows justify the difference. Avoid claiming a low-price advantage over Lawn.

### Included AI budget

For an initial economic test, reserve **at most $1 in actual hosted AI provider cost per paid workspace/month**, independent of seats. This is a tentative internal cost ceiling (6.7% of $15 gross revenue), not a customer cash balance, finalized credit count or token promise. At full 100-billing-GB storage, $15 minus $1.50 storage minus $1 AI leaves **$12.50 before every other cost**; this is not profit or gross margin after all service costs.

Derive the public credit allowance from measured task/model costs, retries and a cost buffer. Show task estimates, reserve a maximum charge, settle actual work and enforce the provider-cost ceiling. Determine whether that allowance offers useful work in a pilot before advertising it. No numeric token allowance is supportable until models, tasks and conversion rules are selected.

MCP entitlement and AI charges remain separate: ordinary MCP control commands spend no hosted AI credits. Calls made by the user's own harness are billed by its provider. Explicit jobs using Side Cut's hosted AI consume workspace credits. Exhausted credits should stop those AI jobs while paid MCP control and cloud collaboration remain available for a valid subscription.

### Bring your own key (BYOK)

Workspaces may connect their own AI provider API key as an alternative or supplement to included credits and top-ups:

- Jobs run with a BYOK key are billed by that provider to the key owner and **consume no Side Cut credits** and do not count against the $1 hosted-AI ceiling. Do not add a markup on BYOK usage.
- Let the user pick per job (or set a workspace default) between hosted credits and BYOK; show which one a job will use before it runs.
- Desktop/local jobs should keep the key on the device (OS keychain) and call the provider directly. Cloud jobs need the key stored server-side: encrypt at rest, never return it to clients after saving, scope it to one workspace, restrict who can add/use it (owner/admin by default), and log usage without logging the key.
- BYOK is a subscriber feature and does not grant entitlement by itself: in-app AI, MCP, cloud and collaboration all require the paid workspace, per the [product access policy](product-access.md). Free users get the editor only; they can use any outside AI tool by editing project files directly, but get no in-app AI even with their own key (decided 2026-11-11).
- Provider errors (invalid key, quota exceeded, rate limits) must surface clearly and must never silently fall back to spending hosted credits.

### Separate storage add-on

Test **+$5/month for +100GB pooled storage**, independently of seats and credits. At 100 additional billing GB fully occupied for a month, incremental raw R2 Standard storage is $1.50; $3.50 remains (70% of add-on revenue) before requests, derivatives, processing and all other costs. That is tentative storage-only headroom, not a validated margin. Multiple retained copies can consume it quickly. Consider a larger-volume storage tier after measuring demand; repeating small add-ons may become unattractive to video-heavy teams.

## Decisions still open

- **Pricing:** validate $15 base / $3 seat willingness to pay, whether MCP needs a separate solo option, annual billing, trial rules, taxes and add-on bundles.
- **Seats/guests:** exact role capability mapping, owner/admin counting, multi-workspace membership, invitations, proration, removals, guest limits and accountless review permissions.
- **Storage/retention:** decimal versus binary bytes; whether originals, versions and derivatives consume quota; upload reservations; trash/backup retention; over-quota behavior; cancellation/nonpayment read/export grace period and deletion notice. Recommend blocking new uploads at quota and offering export/deletion, with a disclosed retention policy before launch.
- **AI:** supported tasks/providers, measured cost distribution, useful included allowance, credit conversion, renewal/expiry/rollover, top-ups, BYOK supported providers and key storage, member limits, partial-failure refunds and handling unknown provider outcomes.
- **Validation:** instrument actual storage amplification, read/write volume, processing cost, AI redemption, payment fees and support load before finalizing prices. This research did not test checkout, perform an entitlement/security audit, or establish production retention behavior.

Owner decisions recorded 2026-11-11: $15 base, $3 additional creator seat, free reviewers, +$5/100GB storage, AI top-ups and BYOK (subscribers only) accepted; free tier is editor-only. No source code or billing behavior has been changed.
