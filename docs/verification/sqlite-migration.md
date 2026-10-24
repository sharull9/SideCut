# SQLite migration verification

SQLite now owns persistent application data in desktop and web. The existing
project coordinators still own commands, revisions, journal replay, and undo.
TanStack DB was evaluated from its overview and SQLite persistence guide; it was
not added because replacing storage does not require a second mutation model.

## Implementation

- `packages/core/src/sqlite.ts` contains the shared schema and atomic
  compare-and-swap transactions. A versioned `documents` table partitions
  snapshots, previous versions, preferences, resource metadata, assets, segments,
  disposable caches, and migration markers by collection.
- Electron uses its built-in `node:sqlite` driver in the main process and stores
  `sidecut.sqlite` in the app profile. WAL and full synchronization are enabled.
  The preload exposes storage requests and file operations, not SQL or paths.
  The host rejects renderer access to authoritative snapshots and their migration
  marker. IPC checks the trusted main frame.
- Web uses pinned `@sqlite.org/sqlite-wasm` 3.54.1-build1 in a dedicated worker.
  The SAH pool VFS persists SQLite in OPFS. A Web Lock covers opening, transaction
  execution, database close, and VFS pause, allowing other tabs to acquire the
  same storage without requiring cross-origin isolation headers.
- Media files, asset files, and binary cache values are staged before committing
  their references. Desktop files live in the profile's `storage-files`; browser
  files live in OPFS `sidecut-files`. Filenames, MIME types, and modification times
  round-trip. A tagged codec preserves Blobs, buffers, and typed arrays without
  confusing user metadata with internal file references.
- Preferences now persist in SQLite. Synchronous transition-default reads use a
  hydrated in-memory view; preference writes confirm the durable commit first.
- Source JSON, IndexedDB, and localStorage data are retained. Migration markers
  commit with imported metadata. Failed imports do not select an empty writable
  replacement, and a subsequent repair can retry. Existing staged browser journals
  are replayed before migration. Damaged current snapshots can use valid backups.
- Disposable analysis caches start fresh. Their metadata retention is bounded;
  old IndexedDB caches are no longer written.

## Verification

`vp run check` passes formatting, lint, all TypeScript programs, and 348 tests in
76 files.
The new native tests exercise real SQLite rollback after an injected SQL failure,
stale saves, legacy migration and retry, missing-current backup recovery, actual
file encoding, and the restricted host bridge. Existing host backup tests now
inspect SQLite rather than obsolete JSON save files.

`vp run build:desktop` builds both production web assets (including SQLite worker
and WASM) and Electron code. The packaged and installed Windows smoke workflows
seed a legacy JSON project, verify that the app opens it, edit/import media,
export/probe/decode through the shipped binaries, archive, restart, and run the
bundled CLI. The verifier checks the SQLite file header and confirms that the
legacy source JSON remains unchanged.

The production browser editing journey passes in Chromium 156 and Firefox 157:
project import, edit, save, page reload, PCM audio import, VP8/Opus WebM export,
WAV export, archive creation, and archive reopening. Firefox still emits the
previously observed recoverable React hydration errors in the production journey.

The isolated migration suite passes in Chromium and Firefox. It checks recovered
legacy snapshots/journals/media, untouched originals, asset and segment migration,
file metadata, binary cache values, preferences, restart persistence, missing-file
relinking, atomic asset merges without overwriting local metadata, failed-save
recovery, interrupted migration retry, and concurrent tabs with one successful
compare-and-swap and one rejected stale writer. See
[migration browser evidence](sqlite-browsers.json) and
[production browser evidence](sqlite-production-browsers.json).
The [installed Windows evidence](sqlite-installed-windows.json) includes the
installer hash and confirms removal of the temporary installation.

Windows Playwright WebKit 27.2 fails a direct `navigator.storage.getDirectory()`
probe with `UnknownError: The operation failed for an unknown transient reason
(e.g. out of memory).` This happens before SQLite is opened. The app now reports
that durable browser storage is unavailable and suggests a compatible browser or
desktop app. WebKit is not accepted for this migration on this host. This result
does not establish Safari behavior on macOS or iOS.

## Reproduction

```powershell
vp run check
vp run build:desktop
vp exec node scripts/package-desktop.mjs
vp run verify:windows-install

# With the web dev server running on loopback port 4270:
vp run verify:sqlite

# Production browser journey, with separately named evidence:
$env:SIDECUT_VERIFICATION_PREFIX = 'sqlite-production'
vp run verify:browsers
```

Browser verification commands exit nonzero while the WebKit storage gap remains.
The dev server can be started from `apps/web` with
`vp dev --host 127.0.0.1 --port 4270 --strictPort`.

## Limits

- macOS/Linux native installers and real Safari/iOS were not run on this Windows
  host. Public HTTPS hosting and browser eviction/storage-pressure behavior were
  not tested. Browser storage is still subject to origin quotas and eviction.
- Legacy originals and unreferenced staged files are retained for recovery.
  Automatic file garbage collection is deferred; replaced resources and cache
  files can consume additional disk space. No user-authored data is reset during
  schema upgrades.
- SQLite is local persistence. No server or cross-device synchronization was added.

References: [TanStack DB overview](https://tanstack.com/db/latest/docs/overview.md),
[SQLite persistence guide](https://tanstack.com/db/latest/docs/guides/sqlite-persistence.md),
[SQLite WASM persistence](https://sqlite.org/wasm/doc/trunk/persistence.md).
