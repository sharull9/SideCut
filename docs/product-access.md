# Product access

Product decision recorded on 2026-11-03; revised 2026-11-11.

## Licensing and hosting model

**The entire product is open source**, including the editor, live studio, MCP integration, cloud services, collaboration and AI features. Anyone may self-host every component free of charge, using their own infrastructure, storage and AI provider keys.

**Payment applies only to our deployed (hosted) version.** The table below describes access on our hosted service. Self-hosted deployments run with paid-access checks disabled.

## Access on our hosted service

| Offering                                 | Access                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Video editor                             | Free and open source. Local editing does not require a paid plan.                            |
| Live streaming studio                    | Paid on our hosted version (decided 2026-11-11). Open source; free when self-hosted.         |
| MCP integration                          | Paid. Users can connect their own AI harness to control the editor and studio through MCP.   |
| Cloud file uploads                       | Paid.                                                                                        |
| Cloud team sharing                       | Paid.                                                                                        |
| Collaborative cloud comments and replies | Paid.                                                                                        |
| AI usage credits                         | The product will provide credits for AI usage. Allowances and pricing are not yet specified. |
| In-app AI (hosted credits or BYOK)       | Paid. Bringing your own API key does not unlock in-app AI on the free tier.                  |

On our hosted version, free users get the video editor only. They can still use any AI tool they like by editing project files directly on disk; Side Cut does not block that, but our hosted version provides no live studio, in-app AI, MCP, cloud or collaboration features without a subscription. Users who want those features without paying can self-host them (decision recorded 2026-11-11).

The later decision that MCP is paid supersedes the earlier description of free MCP access. Local project comments are distinct from paid collaborative cloud comments.

Tentative pricing ($15/workspace, $3 per additional creator seat, free reviewers, +$5 per 100GB, AI top-ups, BYOK for subscribers) is recorded in [Lawn pricing research](lawn-pricing-research.md); it is not yet implemented. All source is licensed under the [GNU AGPL v3](../LICENSE) (`AGPL-3.0-only`, decided 2026-11-11): anyone who runs a modified version as a network service must offer its source to that service's users.

The [AI credits design](ai-credits-design.md) proposes included workspace credits, cost previews, reservations and a Usage dashboard. Credit packaging and lifecycle rules in that document remain proposals. Paid MCP access and AI usage charges are separate: ordinary control commands do not imply a model call.

## Implementation boundary

This document records the intended product policy, not a working payment system. Existing MCP adapters and cloud upload/share/comment handlers do not yet enforce this complete paid-access boundary. The existing hosted job entitlements are not proof of a paid subscription for these features.

Before paid launch, add payment-backed entitlement checks on our hosted deployment to the live studio, MCP access, in-app AI jobs (hosted or BYOK), and the cloud upload, sharing and collaborative-comment service boundaries, with explicit expiry and revocation behavior. Keep free editor operations independent of those checks. Gate the checks behind deployment configuration (for example, a billing-enabled flag that defaults to off) so self-hosted builds run every feature without a subscription; billing must not be required to build or run the open-source code. An MCP client must not receive broader permissions by paying; existing project, team and guest authorization still applies.
