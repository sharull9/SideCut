# LV013 library browser verification

Verified on Windows on 2026-11-01. LV013 remains in progress because the upload lifecycle and live private-storage acceptance are unfinished.

The Teams dialog now mounts a team-scoped cloud library with folder creation, folder filtering, name/newest sorting, search, selection of up to 100 loaded files, move, archive and restore. Viewer access hides write controls; backend membership checks remain authoritative. Updates show pending/success/error states, and a failed update preserves the selection for retry. Filter changes clear selection.

Production browsing uses `library.page` and Convex cursor pagination, loading 25 files at a time. Tenant/archive/folder indexes support browsing and name ordering; a tenant/archive/folder-filtered full-text index supports name search, including token prefixes. Search results use relevance order, shown explicitly in the order control. Clearing search restores the chosen browsing order. The older `library.list` API retains its original bounded behavior for compatibility; the production UI no longer uses it. New indexes and the new query require the normal Convex deployment before use against a hosted backend. This verification did not deploy them.

## Browser checks

Used the shared browser preview with the actual `LibraryBrowser` component, real Convex handlers/schema and a local `convex-test` database. The fixture clearly labels local data and has separate authenticated owner and viewer identities. It uses two-item pages to exercise pagination with a small dataset. Start it with `vp exec node scripts/serve-cloud-library-fixture.mjs`, then open `http://localhost:4317/tests/browser/cloud-library.html`; add `?role=viewer` for the read-only journey. Restart the fixture server after server-side edits to recreate its database and handlers.

| Check                    | Observed result                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search and no results    | Camera matched alone; an absent query displayed the empty-search message. After indexed search was added, `inter` matched Interview final and displayed disabled Search relevance ordering.                     |
| Folder creation and move | Created Browser verified, moved Camera test into it, and the row and folder-filtered view reflected the mutation.                                                                                               |
| Archive and restore      | The file left the active view, appeared in the archived view, and restored successfully. Repeated after switching the fixture to the paginated query.                                                           |
| Failure and retry        | A one-shot HTTP failure displayed the generic error and kept the checked row; retry succeeded. Verified for archive and again for restore after pagination.                                                     |
| Pagination               | Two rows initially; Load more added the third, retained the checked Camera test row, and disappeared at exhaustion.                                                                                             |
| Viewer                   | Read/search/pagination worked. After loading all pages, three rows and zero selection inputs or write buttons.                                                                                                  |
| Narrow screen            | At 390 × 844, long multilingual names wrapped. Owner document width was 375 with a vertical scrollbar; viewer document width was 390. Neither exceeded the 390-pixel viewport.                                  |
| Editor integration       | Opened Teams in the running editor at localhost:3000; the signed-out dialog rendered within the narrow viewport (343-pixel width, 16-pixel left offset). Existing other-tab editing protection remained active. |

Browser automation initially timed out on controls removed by the build-triggered fixture reload. Refreshed the snapshot and repeated those interactions against the current page successfully. The injected HTTP 400 during failed-update testing was expected. Agent-owned preview tabs were closed; the user's existing tab was preserved.

## Automated checks

- 728 tests passed across 150 files, including the six library/version tests.
- A 1,005-file regression traverses every cursor page without duplicates or omissions, finds a match beyond the previous 1,000-record cutoff, and checks tenant/archive scope and page-size limits.
- Workspace lint, typechecking and web build passed. The standalone browser fixture server also passed a strict TypeScript check.
- Targeted formatting passed. Two unrelated pre-existing workspace formatting failures remain in `apps/web/src/modules/cloud/config.test.ts` and `scripts/verify-cloud-teams.mjs`.

Logs: `logs/lv013-library-ui-{all-tests,backend,lint,types,build}.log`, `logs/lv013-library-fixture-types.log` and `logs/lv013-library-browser-server.log`.

These checks do not establish hosted OAuth, deployed reactive pagination, R2 upload/delivery, quotas, cancellation/cleanup, processing, thumbnails or device/platform acceptance. Customer uploads remain unavailable in this UI.
