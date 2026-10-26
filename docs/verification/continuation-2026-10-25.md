# Continuing the adapter roadmap

Later work continues in [the browser, keyboard and range export follow-up](continuation-2026-10-25-followup.md).

The user requested continued implementation until the session's five-hour usage
limit. This continuation started at 2026-10-25 11:55:42 UTC, after CLI 130.29.
No global launcher, remote message, PR, commit or release was requested.

CLI phases 130.30–130.53 now have verified adapter implementations and individual
acceptance recorded in the roadmap. Reports are `cli-resources.md`,
`cli-analysis.md` and `cli-library.md`; their runtime evidence comes from actual
Windows Electron/CLI harnesses. Native transport/headless/SSE/library differences
remain documented, and these checks do not establish full upstream parity.

The final regression run passes 509 tests in 108 files. Lint and TypeScript pass.
Production desktop/SDK builds and unpacked Windows packaging pass. The packaged
smoke test passes isolation, encrypted credential round-trip, exclusive lock,
media encoding/decoding, archive, SQLite reopen, CLI and a Unicode/space profile.
The aggregate
format gate fails only on pre-existing workspace CSS formatting. Existing
uncommitted work from earlier conversation phases remains in the shared checkout.

MCP group 131 now has all 43 individual tool acceptances. The server uses captured
native tool schemas, native defaults/annotations, shared readable formatters and
raw JSON selection. It initializes offline, verifies per-call project ownership,
attributes client edits, sends image blocks first and returns plain tool errors.
The real SDK/stdio test covers two owner profiles; the Electron runtime exercises
all 43 successes and failures, undo, retries, cancellation, cached transcription
and fixture-only generation. See `mcp-adapters.md` and its runtime JSON.

Group 134 now has all individual interaction acceptances, including clip menus,
linked clipboard, snapping modifiers, marquee cancellation, scroll/zoom, stationary
drag autoscroll and keyboard move/trim. See `editor-interactions.md` and its runtime
JSON. Native full keymaps and unsupported interaction scopes remain documented.

Phase 132 SDK usage patterns now pass real HTTP and separate built Node SDK
subprocess acceptance against Electron. Helpers, JSON command input types, guarded
dry-run/apply, lost-reply retry, conflict handling, caption edits and render outputs
are recorded in `sdk.md` and `sdk-runtime.json`.

The UI export presets now share service sizing, bitrate and format validation;
full-resolution WebM includes a verified 4K canvas. Missing portrait disables
Queue. Audio-only WAV remains available with unsupported video. Actual Windows
MP4 exports pass H.264 review/1080/portrait/final and 4K HEVC dimensions, durations
and frame counts. See `export-presets.md` and its runtime JSON. The menu and export
dialog have zero automated WCAG violations. The older agent/UI workflow also
passes its 680px accessibility, clipboard, resize, range and queue acceptance.

Final follow-ups preserve legacy explicit relink requests by skipping automatic
folder-author injection in CLI/HTTP/SDK. Clip keyboard activation now survives
window blur and canceled drags. The new interaction runtime passes that exact
keyboard regression. The legacy agent/UI harness was updated for rendered quality
checks and cache-independent missing-asset expectations.

Production Chromium and Firefox journeys pass import/edit/reopen/save, VP8/Opus
WebM, WAV and archive reopen. Firefox retains the pre-existing React hydration
warnings. WebKit still fails its OPFS/storage/media prerequisites; its failure is
recorded in `continuation-2026-10-25-browsers.json`. No public hosting was tested.

The five-hour wall-clock checkpoint was reached at 2026-10-25 16:55:42 UTC. This
does not assert that a provider usage quota was exhausted; that status is not
available through these tools. The T3 restart interrupted the dev server, which
was restored at `127.0.0.1:4270`. Work and evidence are saved without commits,
publishing, remote messages, or a global launcher installation.

One extra repeat of the older CLI render harness stalled during final checks and
was stopped. It is not recorded as a pass. Its earlier acceptance evidence stays
separate from the newly passing dedicated export, MCP and SDK runtimes.

Next work: investigate that stalled repeat, then the recorded Firefox hydration,
WebKit/native-platform, full keymap, persistent queue, long-form quality and
upstream golden/round-trip gaps. Do not reimplement the completed adapters.
The pinned reference checkout remains at
`C:/Users/Arafa/.cache/sidecut-tandem-reference`, revision
`735a9b8e162c1f951044baa892d94993869f2e77`.
