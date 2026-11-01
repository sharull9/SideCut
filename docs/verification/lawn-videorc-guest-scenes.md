# LV015–LV016 verification

Implemented on 2026-10-30 as a continuation of the approved Lawn/Videorc plan. Both phases remain in progress: this slice adds guest-review services and a reusable scene/output engine; it does not claim a finished guest-review page or integrated native live studio.

## LV015 — Share grants and guest review

- Share grants bind to exactly one immutable ready version. Public means an unlisted bearer link; private requires current team membership. There is no public listing or implicit access to other revisions.
- Cryptographically random 256-bit link and session tokens are stored only as SHA-256 hashes. Optional passwords use random salts, Node scrypt and timing-safe comparison. The opening action rate-limits each grant to 30 attempts per minute, including unsuccessful passwords. This aggregate limit can temporarily delay legitimate guests; it is not per-client abuse prevention.
- Expiry is mandatory and limited to 90 days. Guest sessions last at most 24 hours and never outlive the grant. Every guest read, comment, heartbeat and delivery authorization rechecks expiry, revocation, ready version, archive state and private membership. Private sessions also bind to the authenticated recipient.
- Grant listings and guest views exclude token hashes, password hashes, project snapshots, original keys and playback keys. The share-creation response returns the bearer token once; callers must keep it out of analytics, logs and query strings. A future guest page should consume it from the URL fragment.
- Guest point/range comments and replies are scoped to the grant and version. Retry keys deduplicate identical requests and reject conflicting replay. Concurrent replies are separate records. The initial review has a 500-comment cap; pagination and larger-library operation remain future work. Guests can resolve/reopen only their own root threads. The authenticated editing team controls review/rework/done with optimistic revision checks.
- Heartbeats update at most once per ten seconds; presence reads ignore sessions unseen for 45 seconds and examine the 100 most recently created sessions. Guest names are self-declared, not verified identities. Clients must heartbeat and refresh presence; wall-clock passage alone does not invalidate a cached Convex subscription.
- `storage.guestUrl` authorizes playback or original delivery separately. Disabling downloads blocks original delivery but cannot prevent saving playable media. Fresh media grants fail after revocation/removal; already-issued R2 URLs remain valid for up to 60 seconds, and open responses can continue. URL expiry is bounded by share and session expiry. An authenticated proxy is needed for immediate byte-delivery revocation.

Tests use actual Convex handlers and its test database. They cover password denial, hashed credential storage, sanitized metadata, original-download policy, revocation, private recipient binding, current membership removal, grant/version isolation, retry conflict, concurrent replies, root-thread ownership, comments policy, heartbeat expiry, workflow conflict and share expiry.

Not accepted: guest-review UI, browser private OAuth return, real R2 object delivery/ranges/revocation, view counting, team feedback UI/editor handoff, abuse quotas, retention and cleanup. LV013/LV014 processing and playable-object acceptance remain prerequisites for a real hosted journey. No guest link was externally published and no R2 resource was provisioned.

## LV016 — Saved scenes and frame commits

`@sidecut/core/live-studio` saves serialized editor project compositions, supports named scenes, optimistic revision checks, explicit switching and persistence/restore. Saved edits are drafts until an explicit switch. Active snapshots are deeply frozen. The studio preserves the exact active commit revision through restore, independently of later saved drafts. Scene and file sizes are bounded; active scenes cannot be deleted, and live switches must preserve output dimensions and rational frame rate.

Scenes reuse the editor's `framePlan`, picture transforms, opacity and rectangular crop masks. The browser output uses the existing `paintPicture` compositor, including its supported effects, layer styles and cutout behavior. This introduces no separate scene geometry math. Arbitrary new live mask shapes are not implemented.

`@sidecut/platform-browser/live-studio` renders into an offscreen canvas, then copies only the completed frame to the preview canvas. Recording uses explicit `requestFrame()` capture from that same canvas. Overlapping renders skip rather than queue unbounded work. If a switch supersedes an asynchronous render, that frame is discarded before publication. Abort/render failure leaves the prior output and frame metadata intact. Closing stops the output's capture tracks. Callers must render the first frame before obtaining a recording stream.

Core tests cover editor geometry/crop equivalence, frozen snapshots, stale edit rejection, explicit draft activation, incompatible output rejection and persistence. `vp exec node scripts/verify-live-studio.mjs` runs a real Chromium canvas/MediaRecorder/video-decode check through a Vite development module harness:

- Commit revision 3 produces red preview pixels; revision 4 produces green preview pixels.
- A real VP8 WebM decodes to red before the switch and green after it.
- A pre-aborted render preserves the last committed frame.
- An in-flight superseded render is discarded, an overlapping render skips, and the next frame publishes revision 5.
- Closing stops every capture track.

The exact evidence is in [scene-switch JSON](lawn-videorc-scene-switch.json) and [recorded WebM](lawn-videorc-scene-switch.webm). This is a development harness with synthetic solid-color scenes, not production editor/native device acceptance. Saved composition time currently follows the caller's timeline time. The output is video-only; it does not claim live device ingestion, audio mixing, sound routing, native FFmpeg scene commits or streaming. Studio controls, durable app storage wiring, live source lifecycle, physical capture, prolonged switching and native recording integration remain open.

## Validation

`vp run check` passed formatting, lint, workspace typechecks and 652 tests across 138 files before the final small expiry-bound adjustment. `vp run build:cloudflare` passed. The real Chromium scene harness passed, including decoded recording checks. The final checks are recorded below after rerun. Convex codegen synchronized the new schema/functions to the existing development deployment and regenerated bindings; no production deployment was performed.

Final rerun: `vp run check` passed with 652 tests across 138 files after the expiry adjustment and superseded-frame guard. `vp run build:cloudflare` passed; the Chromium scene harness passed with preview/decoded-recording colors, overlap rejection, stale-frame discard, abort retention and track cleanup. Logs are local artifacts in `logs/lv015-lv016-check.log` and `logs/lv015-lv016-build.log`.
