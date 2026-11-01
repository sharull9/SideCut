# LV030–LV032 accounts, studio automation and restricted controls

Continued the approved phase plan and audited the checklist through LV032. All three new phases remain in progress. Their service APIs and local acceptance are described here; production payment, controls and LAN/device acceptance remain open.

## LV030: server-owned usage and entitlements

`accounts` stores one service account per team. New teams receive a server-defined allowance of 10,000 processing units when their first publish job reserves work. A publish job reserves `max(1, word count)` units, up to the existing 1,000-word payload limit. These are internal work units, not currency or a published pricing plan. No payment request is made.

Submission checks entitlement and available quota inside the job-creation transaction. A rejected reservation rolls back the job insert. Duplicate request keys return the original job without reserving twice. The first committed checkpoint consumes half the units, rounded up; the second consumes the rest. Duplicate acknowledgements cannot charge twice. Cancellation, revoked authorization, terminal claim failure and exhausted attempts release the unfinished reservation while retaining committed usage. A reduced quota blocks new work without rewriting prior usage.

Internal `billingEvent` handlers accept validated event IDs, increasing sequence numbers, enabled state, quota and expiry. Exact duplicates are ignored; changed payloads under the same event ID fail. Older events are retained for audit but cannot overwrite newer entitlement state. An expiry of zero means no expiry. Worker claims/checkpoints enforce the current entitlement. These functions do not expose a browser route for granting credit.

There is no checkout, payment-provider signature verification, invoice/refund integration, monthly usage reset, storage billing or deployed payment webhook. A future verified provider adapter must call the internal handler. Test entitlement events prove ordering/account behavior, not successful billing.

### Export, deletion and retention

`exportData` returns creator-owned jobs for one authorized team in cursor-based pages, with that user's consent and the team usage account. The query uses a team/user index and accepts up to 50 jobs per page. It does not export another member's job payloads.

`deleteJob` requires the creator and team access. Running/queued jobs must first be cancelled. Deletion clears the title, description, transcript, chapters and output text. A minimal job tombstone, request identity and usage ledger remain, so a repeated request cannot silently run and charge again. It does not delete original media versions, storage objects, backups, team membership or all account records.

Internal `purge` applies the same content removal to terminal jobs created more than 30 days ago. Each call handles up to 20 rows for each of ready, failed and cancelled states. Its status/deletion/time index excludes existing tombstones without scanning them. Pending jobs are not purged. A deployment must schedule this handler; no retention cron was installed in this slice. Stalled reservations can be released by cancellation or the existing failure/resume flow.

## LV031: existing host adapters own studio actions

`studio` is part of the existing service schema. It runs through `ProjectAPI`, typed `SideCutClient.studio`, schema-driven CLI options and the new MCP `studio` extension. The pinned 43-tool reference and hash remain unchanged; inventory tests require all 43 tools plus this one SideCut extension.

Supported actions are:

| Action             | Behavior                                                                           |
| ------------------ | ---------------------------------------------------------------------------------- |
| `status`           | Return current project/studio revisions, saved scene names/IDs and active scene ID |
| `save`             | Freeze the current project composition as a saved scene                            |
| `switch`           | Commit a saved scene as active                                                     |
| `remove`           | Remove an inactive saved scene                                                     |
| `recording-status` | Return IDs, states and elapsed time for the current project's native recordings    |
| `recording-stop`   | Stop one explicitly identified existing recording                                  |

Scene mutations require the project revision, studio revision, target ID and an idempotency key. The journal records the normalized intent, author and atomic edit. Matching retries return the original receipt with current state; conflicting reuse fails. Scene state is stored in project metadata through the coordinator, so existing SQLite saving, undo and edit/change events apply. A scene snapshot excludes the studio state/intent metadata to prevent recursive snapshots.

The SDK adds its author. HTTP/MCP reuse existing author handling, authentication, cancellation and headless host leases. CLI discovery comes from the service schema, for example:

```powershell
node scripts/sidecut-cli.mjs studio --action status --endpoint-file <endpoint-file> --json
```

Recording status does not return stream URLs, device details or paths. Stop checks the recording's project and ID. `NativeRecorder.stop(expectedID)` checks the active session again before stopping it, so an old request cannot stop a replacement recording. Repeating a completed stop reads the confirmed library state rather than stopping another session. A successful stop publishes an authored `studio` event. Aborting before an action prevents it; a recording already stopped cannot be restarted by cancellation.

Automated recording start remains unavailable. It must not bypass visible desktop capture/permission controls. Scene automation persists the active snapshot but is not yet wired into an active production studio preview/native compositor. Production UI controls and further capture-grant integration remain open.

## LV032: a separate restricted TLS service

`RemoteControlServer` is an opt-in HTTPS listener for a concrete private IPv4 address or loopback. It rejects wildcard and public-address binds and requires a certificate/key. The general-purpose `LocalHTTPService` remains on loopback; its token, arbitrary edits, media paths and source bytes are not forwarded to this listener. The new listener is not automatically started by the desktop app.

Only POST `/pair` and `/intent` exist. Other routes, including `/v1/apply`, return 404. Body size is capped at 8 KiB, with at most 16 connections/in-flight requests. Browser origins must match the configured listener. Responses use no-store headers and generic denied errors.

### Pair locally, sign each command

The host creates a one-use random pairing secret with a 60-second expiry. A remote device supplies its name and Ed25519 public key over TLS. Pairing also requires local operator approval of the name/key fingerprint within 30 seconds. The listener cannot initiate pairing. Public-key parsing does not authorize a device by itself. Closing the authority or losing the request aborts pending pairing.

Each paired device signs a versioned canonical message containing device/request IDs, a sequence counter, expiry, action, target and both project/studio revisions. The host verifies the signature, a strictly increasing counter and an expiry no more than 30 seconds ahead. Tampering, replay, expired requests and unapproved keys fail before dispatch. A device is limited to 60 requests per minute and one action at a time.

The allowed actions are status, scene switch and targeted recording stop. No request can select an arbitrary service operation. Responses contain only confirmed request identity, revisions, active scene ID and an optional recording ID/state. Remote mutations run through the same `ProjectAPI` guard and idempotency handling, with a device-scoped author/key. Failed requests consume their accepted sequence; a retry needs a new sequence while retaining its logical request ID.

Revocation aborts in-flight actions and rejects later requests. Authority shutdown clears pairing and devices. Pairings are memory-only, so restart requires pairing again. A completed scene change or physical recording stop cannot be undone merely by revoking its response.

Phone/pairing UI, local shortcut UI, deck hardware integration, QR/discovery, device persistence, trusted LAN certificates, a browser control page and real phone/network acceptance remain open. TLS/crypto tests on loopback do not establish LAN usability. No LAN listener was enabled for normal desktop sessions.

## Acceptance and checklist audit

The account fixtures execute real Convex mutations and scheduled workers with synthetic ready-source records. They cover atomic quota rejection, exact partial-work accounting, cancellation, duplicate/out-of-order billing events, expiry, creator/tenant access, text deletion, request tombstones and retention idempotency.

`studio-remote.test.ts` uses the real host, SQLite repository, local HTTP service, SDK and CLI. It verifies scene persistence, stale/conflicting requests, cancellation and undo. MCP tests discover the extra tool over stdio and call its status action while preserving the pinned reference hash. Recording-stop fixtures check project/ID scoping, retries and authored events; the existing real FFmpeg recorder test also rejects a mismatched stop ID before producing a valid recording.

Remote tests use actual Ed25519 keys and signatures and a real HTTPS loopback listener with the fixture CA. They check altered signatures, expiry, replay, extra fields, request limits, approval shutdown, revoke during an action, confirmed studio changes, reduced responses, untrusted origins and rejection of general API routes. Test approval callbacks are synthetic; no physical operator/device acceptance is claimed.

The checklist now explicitly identifies nine phases as done within their recorded acceptance scope: LV001, LV002, LV004, LV006, LV007, LV008, LV009, LV010 and LV011. Their linked reports were checked; earlier physical/platform limits remain explicit. LV003, LV005 and LV012–LV032 remain in progress. LV033–LV035 remain pending. No phase was promoted solely because a core test passed. Older LV006–LV008 notes now point to later phases that covered video encoding, synthetic long-run capture and large-file imports.

Final validation passed `vp run check`: formatting, lint without warnings, all workspace typechecks and 703 tests across 146 files. `vp run build:desktop` passed for the production web app, Electron main process and preload. `git diff --check` passed. The initial full test run found four MCP inventory assertions that assumed exactly 43 tools; they now explicitly require the original 43 plus the studio extension, with the pinned reference/hash still checked.

The [machine-readable checklist audit](lawn-videorc-phase-status.json) confirms all 35 phase IDs, the 9/23/3 status counts and existing checklist evidence paths. This checks links and recorded statuses; it does not rerun the earlier device/platform acceptance.

Logs are `logs/lv030-032-check.log`, `logs/lv030-032-types.log` and `logs/lv030-032-build.log`.
