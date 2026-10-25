# Resources and asset adapters

Phases 128.02, 128.03 and 129.01 through 129.03 are verified on Windows
against Tandem revision `735a9b8e162c1f951044baa892d94993869f2e77`.
The [contract fixture](../../tests/fixtures/tandem/resources-assets.json) records
the pinned request defaults, result fields and failures. Checked phases cover
the behavior below within the stated compatibility limits.

## Supported behavior

`relink` searches the managed project folder, or the selected media root, and
explicit `search` folders recursively. Relative search paths resolve from that
root. Missing folders fail before edits or resource writes. Hidden entries,
`node_modules` and symbolic links inside a search folder are skipped. Duplicate
paths appear once. Matching ignores filename case. A known sampled SHA-256
fingerprint selects matching content and ignores modification time; without a
valid fingerprint, exactly one candidate is required. Multiple candidates remain
ambiguous. Reports include searched folders, old/new paths, missing media and
clip counts. A Live Photo companion beside its still updates its path too.

Dry runs leave the project and browser resources unchanged. Apply stages matched
resources, then commits all path changes through one shared edit with the
requested label/author. A staging failure, cancellation or stale project leaves
the project revision unchanged. One undo restores all previous paths. The
existing explicit `mediaID`/`path` replacement remains available separately.

`effects` returns the 15 existing effect definitions sorted by category/name,
eight transitions with reference default durations, five named layouts and all
fixed/effect animation paths. Case-insensitive type filtering only filters the
effects array. Unknown types fail. The existing `rendered` extension and renderer
warning remain; this phase does not add effect renderers.

`assets-providers` reports all 12 registered providers with kinds, capabilities,
status and rules. Credential values are not included. Disabled, stub and
missing-key providers retain their real status.

`assets-search` defaults to local-only, empty text and 20 results. Limits clamp
to 1–200. `kind`/`kinds` and `provider`/`providers` accept lists or comma-separated
strings. Kind names accept plurals and the reference aliases. Unknown providers
fail even on a local search; invalid kinds and durations fail before a provider
search. With `online:true`, omitted providers select usable providers that search
the requested kinds. Explicit unavailable providers produce per-provider errors.
Successful provider results enter the catalogue before local matching/counting.
Cancellation stops the request and propagates to provider transport. Completed
provider results may remain cached after cancellation.

`assets-fetch` downloads and normalizes an asset by catalogue ID without changing
the project. A normalized cache entry avoids another download. Existing licence
files survive normalization; remote downloads receive a licence snapshot.
Plain-text licence files remain stored and their response uses catalogue metadata.
Fontsource IDs can be looked up without an earlier search. The existing
`online:false` extension refuses an uncached remote download. Results contain
asset, playable file and licence. Unknown IDs fail.

## Verification

`vp run check` passes formatting, lint, TypeScript and all 435 tests in 90 files.
`vp run build:desktop` passes. New tests cover duplicate names, fingerprint
selection, overlapping search roots, companion paths, cancellation, dry runs,
staging failures, concurrent edits, stale revisions, a multi-file apply/undo, effect metadata,
provider states, query aliases, limits and per-provider failures.

The [Electron acceptance script](../../tests/desktop/verify-resources-assets.mjs)
uses temporary profiles and source folders. It relinks and decodes a real PNG,
checks dry-run/apply/undo/redo, missing-folder and stale failures, and queries the
effect/provider catalogues over authenticated HTTP. It seeds 25 actual library
records, verifies the default 20-result limit and online local-provider search,
normalizes a cube LUT, preserves its licence, and fetches it again from cache.
Asset calls leave the project revision unchanged.

The live public-provider run searches Iconify for `check`, sees those results in
the local catalogue, fetches `iconify:ic:baseline-check`, normalizes the SVG to
PNG and reuses the cached PNG with `online:false`. The saved licence identifies
Apache 2.0 and Material Design Authors. Runtime values are in the
[JSON evidence](resources-assets-runtime.json); the final editor is in the
[screenshot](resources-assets-editor.png). The script records public-network
timeouts or unavailable search responses separately when reproduced offline.

Reproduction uses the repository's Electron acceptance workflow:

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-resources-assets.mjs
```

## Compatibility limits

- Relink scans at most 500,000 entries and stages sources up to 64 MiB each.
  Fingerprints sample both ends using the existing browser encoding. Native
  shared-library fallback is not configured automatically. Existing native paths
  are considered present even if they have not been staged into browser storage;
  explicit replacement can stage such a source. Undo restores paths and retains
  cached source bytes. Interrupted staging can leave unused resource copies.
  Live Photo companion path handling is tested; motion playback is not verified.
- Asset files live in the shared browser SQLite/OPFS library, so `file` is its
  playable filename rather than a native absolute library path. Imported folders
  must be selected/imported before catalogue searches can see new files. Automatic
  native folder rescans and headless asset operations are not added here.
- Keyed/paid providers, direct Fontsource lookup, all public providers other than
  Iconify, and failures during real network cancellation are not retested live.
  Provider transport and decoding retain their existing unit coverage. No paid
  requests or credential changes are made.
- Packaged installation and native macOS/Linux parity remain unverified.
