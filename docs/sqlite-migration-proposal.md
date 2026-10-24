# SQLite for desktop and web

Status: SQLite repository approach approved and implemented. Verification results
are recorded in `verification/sqlite-migration.md`.

## Intent

Use SQLite for persistent application data in the Electron desktop app and the
browser app. Preserve existing projects, resources, saved assets, saved segments,
revision checks, recovery, undo, and `.tandem` interchange.

Assumption: both applications remain usable offline. This change does not add a
server, accounts, or cross-device synchronization.

## Current storage

- Desktop `NativeProjectStore` saves `current.tandem` JSON, a previous valid
  `.bak`, and an exclusive host lock.
- Browser `BrowserProjectStore` uses the `sidecut` IndexedDB database for current
  project selection, snapshots, staged journals, previous versions, and media.
- Asset and segment libraries use separate IndexedDB databases in both web and
  the shared desktop renderer. Derived and audio analysis caches also use
  IndexedDB. Panel sizes and transition sound defaults use localStorage.
- Project coordinators own revision validation, atomic command batches, undo,
  redo, and journal replay. Storage must not become a second editing authority.

## Options

1. **Recommended: SQLite repositories behind the existing application APIs.**
   Share schema and repository behavior across platforms; keep platform database
   initialization separate. This replaces persistence without rewriting editing
   state or adding a parallel optimistic mutation system.
2. **TanStack DB persisted collections throughout.** Its current documentation
   includes browser OPFS and Electron SQLite persistence adapters. This also
   changes collection lifecycles and mutation ownership. It is a larger change
   than replacing persistence, especially for atomic edits spanning project state.
3. **SQLite repositories plus TanStack DB read collections.** Suitable if asset
   and segment views need live filtered/joined queries. Add only where those
   queries replace existing work; keep commands flowing through the coordinator.
   This can follow option 1 without changing the durable project format again.

Reading TanStack DB was requested; adopting it was not explicitly requested.
The recommendation is option 1, with option 3 available later.

## Proposed architecture

### Desktop

Open a profile-local `sidecut.sqlite` in Electron's main process. Prefer the
runtime's `node:sqlite` driver after checking the actual bundled Electron API;
use a supported native driver only if that check fails. The renderer accesses
validated domain operations through the existing preload and IPC boundary.
Do not expose SQL execution or filesystem paths to renderer callers.

Preserve one host authority per profile and existing generation/revision checks.
Save the validated project snapshot and previous valid snapshot in one SQLite
transaction. Keep `.tandem` JSON and archive import/export as interchange formats.
The legacy JSON file becomes migration input rather than a second writable store.

### Browser

Run SQLite WASM in a dedicated worker with durable OPFS storage. Choose the
worker/VFS implementation after checking Chromium, Firefox, WebKit, and build
asset delivery. Keep synchronous SQL away from the UI thread. Continue enforcing
project writer ownership and reject stale saves inside the durable transaction.

If OPFS or worker initialization fails, show an actionable persistence error;
never label an in-memory session as saved. Browser SQLite remains subject to
origin quotas and browser eviction. Downloads remain the portable backup.

### Shared durable model

Use versioned SQL migrations and parameterized statements. Initial tables:

- `projects`: project ID, validated encoded snapshot, prior valid snapshot,
  revision, and saved version token.
- `preferences`: current project ID and application preferences.
- `assets` and `segments`: validated metadata and resource references.
- `resources`: resource identity, filename, MIME type, modification time,
  availability, detail, and binary location.
- `derived_cache`: disposable analysis entries with bounded retention.
- `migrations`: schema and legacy import completion metadata.

Keep source media as files: desktop profile files and browser OPFS files, with
metadata in SQLite. Stage immutable resource files before committing references;
only reclaim unreferenced files after committed-reference checks. A failed
metadata commit may leave an orphan file but must not leave a saved reference
pointing to a partial file. Keep `File` reconstruction at the browser boundary.

## Legacy migration and recovery

1. Open and migrate SQLite before enabling writes.
2. Read legacy data without deleting or modifying it. Validate project snapshots
   with the existing decoder and journal replay, including staged/previous
   recovery. Inventory legacy resources and library entries.
3. Stage and verify media files. Commit imported metadata, project versions,
   preferences, and a migration marker atomically. Keep migration resumable;
   repeated startup must not duplicate data or replace newer SQLite edits.
4. Only select SQLite as the active store after successful validation and commit.
   A failed migration shows a recoverable error and preserves original data.
   Do not silently open an empty project or fall back to another writable store.
5. Preserve legacy originals for recovery. Later cleanup is separate work.

Schema upgrades must never use destructive reset for user-authored data. Corrupt
current snapshots may recover from validated previous snapshots with an explicit
message. Failed saves must preserve the last committed state and surface an error.

## Implementation sequence and acceptance

1. Verify desktop driver support and browser worker/OPFS packaging using the
   pinned runtimes. Lock package versions; do not rely on unreleased examples.
2. Implement shared schema/repository behavior and desktop adapter. Test reopen,
   rollback, stale writers, backup recovery, legacy import, and interrupted import.
3. Implement browser worker adapter and project/resource migration. Verify real
   browser reopen, tab contention, initialization failure, and quota/write errors.
4. Move assets, segments, preferences, and disposable caches to the same storage
   boundary. Preserve file metadata and existing missing-resource behavior.
5. Run repository checks, production browser journeys, desktop packaged smoke,
   and installed Windows smoke. Verify existing media archives and `.tandem`
   files still round-trip. Report native macOS/Linux gaps separately if those
   hosts remain unavailable.

## TanStack DB findings

The overview describes collections, incremental live queries, and optimistic
mutations. Its SQLite persistence guide now explicitly supports local collections,
browser workers with OPFS, and a main-process SQLite owner for Electron. It also
documents coordinated multi-tab writes, durability failures, indeterminate
commits, and schema mismatch policies. These need integration with SideCut's
existing recovery and ownership rules; persistence alone does not provide
cross-device synchronization.

Registry inspection during research found `@tanstack/db` 0.15.2,
`@tanstack/browser-db-sqlite-persistence` 0.2.37, and
`@tanstack/electron-db-sqlite-persistence` 0.2.13. No dependencies were installed.

Sources:

- https://tanstack.com/db/latest/docs/overview.md
- https://tanstack.com/db/latest/docs/guides/sqlite-persistence.md
- https://github.com/TanStack/db/tree/main/packages/electron-db-sqlite-persistence
- https://sqlite.org/wasm/doc/trunk/persistence.md

## Review decision

The user approved the SQLite repository approach. TanStack DB was evaluated;
its collections and optimistic mutations are not part of this migration.
The implementation uses one versioned `documents` table partitioned by named
collection rather than separate SQL tables for each document type. This preserves
the existing JSON codecs and keeps identical transaction rules on both platforms.
