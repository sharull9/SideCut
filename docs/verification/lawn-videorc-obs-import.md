# LV033: OBS scene/profile subset

LV033 implements a documented OBS import subset through the existing guarded project-import service. Fixtures, host/CLI checks, browser rendering and production-editor diagnostics pass. This does not establish complete OBS compatibility or a round trip through every OBS version/plugin.

## Import a collection

Place the scene collection JSON and optional profile inside the host's selected import sandbox. PNG resources must be inside an explicitly approved asset folder within the host project folder.

```powershell
node scripts/sidecut-cli.mjs import obs collection.json --profile basic.ini --asset-root assets --duration 10 --out imported --endpoint-file <endpoint-file> --json
```

The service operation is `import-obs`, also available through `SideCutClient.call("import-obs", ...)`. Direct calls require `path` and `expectedRevision`; the native CLI reads the current revision if none is supplied. Optional fields are `profile`, `assetRoot`, `scene`, `duration`, `name` and `output`.

The existing import flow saves the prior project, checks revision/generation before replacement and rejects output overwrites. Invalid input, cancellation or a stale project leaves the current project unchanged. Image resources remain relative file references; they are not copied or embedded. Keep assets with the managed project or use the existing archive/relink workflow when relocating it. A JSON snapshot alone is not a portable media package, especially in a different folder.

## Supported data

| Data        | Imported behavior                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Scenes      | Up to 100 scenes saved in `sidecut.liveStudio`, following `scene_order`                              |
| Selection   | Explicit `scene`, then `current_scene`, then the first ordered scene; populate the editable timeline |
| Color       | `color_source` and versions v1–v3, packed RGBA and source rectangle dimensions                       |
| Images      | Approved local static PNG with bounded header/chunk inspection                                       |
| Geometry    | Saved absolute position, positive uniform scale, rotation, nine alignment anchors and pixel crop     |
| Layer state | Back-to-front order, visibility and item locks                                                       |
| Profile     | Base canvas and common/integer/rational fps, including 30000/1001                                    |
| Duration    | Still-scene duration from 0.1 to 3,600 seconds; default 10 seconds                                   |

The base canvas allows at most 3,840 pixels per axis and 3,840 × 2,160 total pixels. Frame rate is limited to 1–120 fps. Without a profile, the report names the 1920 × 1080 / 30 fps default. Output scaling, audio, encoder, hotkey and account settings are discarded. Profile credentials are not copied into the project or report.

The selected scene becomes an ordinary editable project. Saved scenes retain separate composition snapshots for existing studio actions. Import never starts capture, audio, streaming, a browser source or an OBS plugin.

OBS and SideCut both paint their stored layer sequence from bottom to top. Conversion accounts for the cropped source's anchor and rotation. Color rectangles use the existing solid/crop compositor, including rectangles with an aspect ratio different from the canvas. PNG geometry uses inspected natural dimensions.

## Unsupported data and diagnostics

Browser, media/video, capture, device and audio sources are unsupported. Groups, nested scene items, group backups, filters, custom scene canvases, bounds modes, flips, nonuniform scales, non-default blending and active item transitions are not converted. OBS's duration-only transition records are accepted because they do not activate a transition.

Unsupported items are skipped and named in the report. Missing references and unsafe/unavailable images are reported too. Unsupported selected scene filters/custom size, an empty supported selection, duplicate source names/UUIDs, malformed profiles and invalid geometry fail the import.

The service/CLI returns the report and stores it in `metadata.sidecutImportReport`. Opening the converted project uses the existing editor's Edit notes notice to show warnings. Counts, scene selection, supported source types and chosen duration are retained. Raw source settings, module data, credentials and device identifiers are not copied into scene snapshots.

There is no new raw-OBS file picker. Conversion uses the host/CLI/SDK operation; the existing project picker opens the result and displays diagnostics.

## Resource boundary

Only explicitly selected metadata files are opened. The importer does not search an OBS installation or enumerate plugin folders. Only referenced, unfiltered `image_source` PNG files become resource candidates. It does not launch a codec process, plugin, URL or capture device to resolve a source.

Without `assetRoot`, images produce diagnostics without opening their files. With approval, checks reject URLs, UNC/device paths, traversal, unsupported extensions and outside paths before image data is opened. Canonical paths reject junction/symlink escapes. Approved paths are stored relative to the managed project folder.

Limits are 20 MiB of collection metadata, 64 KiB of profile metadata, 1,000 uniquely named sources and 1,000 total scene items. PNG inspection allows 64 unique approved resources, 16 MiB per file and a 64 MiB aggregate budget. Source dimensions are positive, no larger than 8,192 per axis and at most 16 megapixels. Animated PNG and malformed chunk structure are rejected. This is a structure/metadata check, not a complete PNG CRC/codec validator; the existing browser image reader performs decoding.

Path tests cover this Windows host, including directory junctions. They do not certify adversarial filesystem races or other operating systems. Moved/deleted files use existing missing-resource/relink behavior.

## References and fixture provenance

The mapping was checked against OBS 31.0.4 and the official API documentation:

- [Scene API](https://docs.obsproject.com/reference-scenes): transform, bounds and crop definitions.
- [Pinned scene serialization/rendering](https://github.com/obsproject/obs-studio/blob/31.0.4/libobs/obs-scene.c): saved fields, ordering, absolute-coordinate compatibility values and duration-only transitions.
- [Pinned collection/profile handling](https://github.com/obsproject/obs-studio/blob/31.0.4/UI/window-basic-main.cpp): collection selection/order and profile video settings.
- [Color defaults](https://github.com/obsproject/obs-studio/blob/31.0.4/plugins/image-source/color-source.c) and [packed color representation](https://github.com/obsproject/obs-studio/blob/31.0.4/libobs/graphics/vec4.h).

The collection, profile and blue PNG in `tests/fixtures/obs` were authored for SideCut. Synthetic private-value sentinels verify that ignored settings do not enter the result. No real account/profile data or third-party art was used. The converter does not bundle OBS or load its plugins. Live OBS round trips and newer-version/plugin-specific formats remain outside this subset.

## Verification

Eight core/host tests cover order/selection, rational fps, geometry, visibility/locks, diagnostics, duplicates, limits, unsafe metadata and the real guarded CLI workflow. Host checks read the approved image through `ProjectAPI`, inspect SQLite data and write a snapshot. Negative cases preserve the project and reject absent grants, traversal, URL references, outside assets, junction escapes, malformed PNG and cancellation.

`vp run verify:obs-import` uses Chromium's real image decoder and the studio compositor. It checks RGB samples before and after VP8 recording/decoding, cropped color bounds, PNG scale/position, hidden layers, scene switching, rotated crop/anchor placement and track teardown. It then opens the converted project in the built production editor, verifies visible unsupported-source notes and reloads from browser storage. The harness waits for storage readiness before opening a file. The [JSON report](lawn-videorc-obs-import.json) records pixels and visible diagnostics.

`vp run check` passed formatting, lint, all workspace typechecks and 711 tests across 148 files. Logs are `logs/lv033-check.log`, `logs/lv033-build-web.log` and `logs/lv033-build-desktop.log`. After regenerating browser evidence, format `docs/verification/lawn-videorc-obs-import.json` before running the formatting check.
