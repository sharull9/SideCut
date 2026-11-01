# LV027–LV029 companion, derived edits and publish jobs

Continued the approved phase plan on 2026-10-31. All three phases remain in progress. The implementation includes local companion/edit APIs and executable Convex job handlers. No deployment, paid model request, external post or publication occurred.

## LV027: reviewable companion behavior

`CompanionBehavior` starts with consent disabled and suggest-only mode enabled. Explicit configuration enables selected event kinds. Welcome templates replace `{author}` as plain text; welcome deduplication uses stable, provider-scoped `authorID` values. Event IDs must also be scoped by the caller. The session retains 1,000 replay IDs, 200 suggestions and up to 1,000 welcomed identities. It stops creating new welcomes when the identity bound is reached. Older event IDs outside the replay window can be accepted again.

Questions become editable draft suggestions. Flags, promises, commands, clip timestamps and reports remain local records. These records do not execute tools, edit a project or generate AI answers. Suggested clips are review points, not saved media. The report API returns structured records rather than sending them elsewhere.

An explicit `post` call can send a welcome or question draft through an injected adapter. Posting requires consent, an enabled kind and suggest-only mode turned off. Calls are serialized and separated by at least five seconds on the caller's monotonic clock. Configuration changes abort the current adapter signal. Providers must honor cancellation and use the supplied idempotency key. Cancellation cannot retract a post already accepted by a provider.

Failed or ambiguous delivery is recorded as failed and never retried automatically. Local suggestions cannot be posted through this API. No provider posting adapter, automatic posting, AI response service, commands UI or moderation authority is included in this slice.

## LV028: retained originals and a single undo step

`planDerivedEdit` creates a serializable recipe, original project snapshot, wire-format edit batch, preview and warnings. Planning runs on scratch coordinators and leaves the source untouched. Snapshots are limited to 20 million characters. Original media references remain in the project; the feature does not overwrite source files.

The supported recipes use existing behavior:

- `clean`: tighten pauses of at least 0.8 seconds to 0.3 seconds.
- `condensed`: tighten pauses of at least 0.5 seconds to 0.12 seconds.
- `noise-cleaned`: enable or add the existing `voiceCleanup` effect on speech audio clips. This filter is not neural speaker isolation.

Optional captions are regenerated after the timeline edits through `planCaptions`, so their words use the resulting timeline times. A locked caption track is rejected. A track named Captions with non-caption clips is also rejected, rather than removed. Generated captions replace the prior caption track inside the reviewed batch. Missing speech transcripts and locked speech tracks block the affected plan.

The batch is decoded and encoded once before review, retaining generated IDs. Preview and apply therefore use the same clip IDs. Applying checks both content and revision against the retained original, or the exact preview for an idempotent retry. The coordinator commits all commands together. One undo restores the original project content, including captions and effects. Retry tests also reopen the persisted project and replay the serialized plan without adding another undo entry. The original snapshot and command batch can be serialized for caller-managed storage; this slice does not add a durable local job queue or project creation UI.

Rendered media, physical audio quality, linked-file lifetime after external deletion and production controls remain unverified.

## LV029: consent and executable server jobs

The public `publishJobs` API exposes `capabilities`, `consent`, `start`, `get`, `resume` and `cancel`. Internal-only `claim`, `checkpoint` and `process` handlers run the worker. Typed public references are available through the cloud package. API declarations include the new modules for offline typechecking; deployment must regenerate the normal Convex bindings.

The available operation is deterministic `publish-pack`. It accepts user-authored title/description, timed transcript words and chapter entries. It returns four text artifacts:

| Output           | Content                                                  |
| ---------------- | -------------------------------------------------------- |
| `transcript.txt` | Words joined as plain text                               |
| `captions.srt`   | Timed word cues with line and angle-bracket restrictions |
| `metadata.json`  | Supplied title/description and `generatedByAI: false`    |
| `chapters.txt`   | Supplied chapter titles with timestamps                  |

The capability response explicitly reports AI disabled and no external publication. There is no generative summary, title generation, thumbnail generation, rendered video, ZIP download or platform publishing claim. Inputs are bounded to 50,000 serialized characters, 1,000 ordered words and 100 ordered chapters at whole-second timestamps. The handlers reject invalid clocks, cues that round to zero milliseconds, multiline cue text and oversized metadata.

### Authorization and consent

Submission requires a ready source version, editing access, a non-archived media record and explicit per-user/team processing consent. Jobs bind to the immutable source version and the current consent generation. Job reads, cancellation and resume are restricted to the creator; another team member cannot read a creator's output merely by knowing the job ID.

Worker claims and checkpoints recheck membership, editing permission and consent generation. Revocation hides prior outputs and stops later commits. Re-enabling consent does not authorize jobs from the old generation. Repeating the same consent setting is idempotent. Cancellation clears artifacts and prevents worker revival.

Payloads and job rows remain in the database. Revocation is an authorization change, not a complete data-deletion workflow. Retention/deletion, usage reservations, billing and wider service quotas remain in LV030. No media is downloaded or sent to a third-party model by this worker.

### Retry and resume

The request key is scoped to the creator. Matching submissions return the same job regardless of object-field order; conflicting payloads or consent generations fail. Scheduling and job insertion use the same mutation. A worker claims a 30-second lease with an increasing attempt number. Only that unexpired attempt can commit the next checkpoint.

The first checkpoint saves transcript/SRT artifacts. The second adds metadata/chapters and marks the job ready. Outputs are computed from the stored payload inside the mutation; clients cannot submit a successful result or arbitrary object key. Duplicate checkpoint acknowledgements do not append artifacts twice. Output reads expose artifacts only after completion.

An expired worker can resume from its committed checkpoint, with at most three attempts. Old attempts cannot commit after a replacement claims the job. An archived or unavailable source fails the claim. Transient action failure leaves the current lease to expire before resume; no external provider retry policy is implied.

The worker is executable server code, not a client-only contract. Local Convex fixtures do not prove hosted deployment behavior, process restart, live storage delivery, provider quality or production retention.

## Verification

`packages/core/src/companion-derived.test.ts` has six tests covering consent/suggest-only defaults, identity deduplication, per-kind disable, editable drafts, rate/concurrency limits, cancellation, local-only actions, ambiguous delivery, retained originals, caption timing, cleanup, stale edits, missing transcripts, idempotent apply and one-step undo.

`apps/cloud/src/convex/publishJobs.test.ts` has six tests using the real Convex test runtime. They execute the scheduled worker, check artifact contents, deduplicate requests, resume committed checkpoints, reject stale attempts, enforce consent generations and creator/tenant/viewer boundaries, test membership removal, permanent cancellation, retry limits and malformed payloads. Ready source records are metadata fixtures; these tests do not verify an uploaded playable object.

Formatting, lint and all workspace typechecks passed. The 12 focused tests passed, including the final request-key and SRT validation changes. `vp run build:desktop` passed.

The default `vp run check` test stage hit six existing five-second desktop CLI timeouts and two cleanup errors after those timeouts. A four-worker rerun passed 690 of 691 tests; the remaining CLI file passed by itself with its original timeout. The final `vp test run --maxWorkers=2` passed all 691 tests across 145 files without changing timeouts or test configuration. This establishes a passing bounded-concurrency suite, not a passing default-concurrency check run on this host.

Logs are `logs/lv027-029-check.log`, `logs/lv027-029-tests-bounded.log`, `logs/lv027-029-cli-recheck.log`, `logs/lv027-029-tests-final.log`, `logs/lv027-029-types.log` and `logs/lv027-029-build.log`.
