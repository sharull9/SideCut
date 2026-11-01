# LV013–LV014 cloud backend verification

Implemented on 2026-10-30 against the existing LV012 Convex/WorkOS tenant model.

Update 2026-11-01: the Teams library UI and indexed cursor query are now implemented and locally browser-tested; see [current browser verification](lawn-videorc-library-browser.md). The bounded `library.list` endpoint described below remains for compatibility, while production UI uses `library.page`. Upload lifecycle and live R2/processing gaps below remain open. The rest of this report records the original backend acceptance snapshot.

## LV013: library and transfers (in progress)

Added team-scoped folders and media records, name search, name/newest sorting, folder filtering, and atomic move/archive/restore operations for up to 100 selected IDs. Viewers cannot mutate. Archive retains versions and blocks transfers and playback. The initial list examines at most 1,000 team records; cursor pagination and indexed search are required before a large-library rollout. Selection is represented by the bulk API's explicit IDs; there is no library UI yet.

Added private R2 multipart actions: start, one-minute signed part PUT, and complete. Storage credentials never enter public API responses. Start reconciles concurrent calls and aborts the losing multipart session. Complete reads authoritative R2 part numbers, ETags and sizes, requires contiguous parts and the expected total size, records acknowledgements internally, completes the object, and verifies object length. A lost completion response can reconcile the immutable source key by HEAD. Client-supplied ETags cannot publish media. Duplicate identical acknowledgements are accepted; conflicting parts and incomplete uploads are rejected.

Configure a private bucket with public access disabled and server-only Convex variables `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Configure bucket CORS for the actual app origin and PUT, and expose ETag if a future uploader needs it. Configure an R2 lifecycle rule to abort incomplete multipart uploads: process termination between R2 initiation and database attachment can leave an orphan. Choose parts satisfying R2's multipart limits; the server currently checks the total and provider enforces individual part constraints. Do not enable customer uploads until quotas, explicit cancellation, cleanup and the browser transfer UI are implemented and tested.

## LV014: version and delivery contracts (in progress)

Each version freezes its snapshot, source key, ordinal and transfer parameters. Reusing a request ID returns the existing version only when parameters match. Ready/failed callbacks are internal Convex functions, unavailable to public clients. Processing attempts use increasing generations: old results cannot overwrite a retried attempt. Output keys must be within the exact version/attempt namespace. Ready versions are terminal and the media pointer advances only to a newer ready version. Uploading/failed replacements retain the previous ready pointer; prior version playback can be requested explicitly.

The R2 playback action checks current membership, archive state, version ownership and readiness before generating a one-minute GET URL. This is a bearer grant: removal blocks new grants, but an already-issued URL remains usable until expiry (and an already-open response can continue). Immediate revocation requires an authenticated serving proxy. Object storage must remain private. A trusted processor must verify MP4 output before invoking `versions.processed`; no processor, queue, transcode service or thumbnail generator is connected yet. A ready database record alone does not establish playable bytes.

## Checks and limits

The local Convex tests exercise actual handlers with the Convex test database: tenant isolation, viewer write rejection, folder ownership, bulk actions, archive/restore, search, idempotent version creation, conflicting replay, out-of-order and duplicate parts, incomplete uploads, failure/retry generation checks, output namespace checks, preservation of prior ready output, historical version isolation and membership removal. The R2 action boundary test verifies unauthorized and unconfigured calls do not contact storage.

`convex codegen --typecheck disable` regenerated bindings and synchronized functions with the existing development deployment; this command's output included uploading functions. No R2 resources or credentials were created. Live R2 multipart completion, actual object authorization/range playback, thumbnails, browser upload/selection UX, processor retries and failure recovery have not been accepted. Both phases remain in progress.

Final validation: `vp run check` passed formatting, lint, all workspace typechecks and 644 tests across 136 files. `vp run build:cloudflare` passed. Existing dependency directive/circular-dependency warnings were emitted by the web toolchain. No live R2 test was run.
