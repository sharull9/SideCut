# Asset actions

Phases 129.04 through 129.08 are verified on Windows against Tandem revision
`735a9b8e162c1f951044baa892d94993869f2e77`. The
[contract fixture](../../tests/fixtures/tandem/asset-actions.json) records the
reference defaults and result fields. Checked phases cover the behavior below
within the stated compatibility limits.

## Supported behavior

`assets-show` reads the catalogue without downloading a file. Results include
available playable/original filenames, the stored licence, and generated prompt
and model. An unknown ID fails. A metadata-only generated asset can be inspected
without contacting its provider.

`assets-use` fetches or normalizes an asset when needed, stages its project
resources and licence, and adds media and provenance through the shared
coordinator. Without `at`, it only adds the media. With `at`, it uses the existing
`placeMedia` implementation for placement, overwrite or insert, optional duration,
picture anchor and pop animation. Stills default to five seconds. Stickers
default to the bottom anchor. Existing media is reused by asset identity or the
project resource path. Music and SFX retain the shared placement engine's gain
rules; the runtime Music track uses -31 dB and a two-second fade out.

The complete edit is validated before resources are staged. Media, placement and
provenance commit together, and one undo restores them. Repeated media-only use
does not change the revision. Locked/overlapping/invalid placement fails without
a partial project edit. The adapter checks project identity/revision across
fetching and resource preparation. The `expectedRevision` extension rejects stale
requests before renderer work. Labels and authors reach the shared history.

Fonts register in the app and report the registered families. LUTs get a staged
resource key usable by the Effects inspector. Fonts and LUTs have no media item;
their provenance is undoable. Existing UI library use calls the same method.

`assets-credits` resolves current catalogue licence records for used media,
recorded installations and assets named in clip tags. Saved project provenance
is a fallback when a catalogue row is absent. Equal credit lines appear once;
required credit wins over courtesy credit. Removed media drops out unless still
named by another use or clip tag. Unknown licences, missing mandatory credit
lines and subscription advice are grouped using the reference wording. Optional
credits appear under `Thanks to` when `includeOptional:true`.

`assets-generate` requires kind and prompt, accepts reference sound/music aliases
and time strings, trims the prompt and validates duration. Variations clamp to
1–4. Sound defaults are non-looping; music defaults to instrumental. The existing
`confirmedPaid:true` extension remains required before provider generation.
Completed takes enter the shared library with their prompt/model. A later
provider failure retains earlier takes. A take that cannot be normalized remains
in the response as `original`, with a failure message and recoverable original
file. Generation does not edit the project.

`assets-install-starter` returns `counts` and `total`: 43 stickers, 32 icons and
15 logos. Default installation only merges metadata. Repeating it preserves
existing rows and downloaded files. Existing `assets`, `downloaded` and
`warnings` response extensions and explicit `online:true` downloads remain.

## Verification

`vp run check` passes formatting, lint, TypeScript and all 443 tests in 92 files.
`vp run build:desktop` passes. New tests cover use plans, media reuse, anchor/pop,
overwrite/insert, rollback, audio/still defaults, catalogue licence precedence,
credit warnings, show provenance, starter counts, generation validation and
preservation of generated originals after normalization failure.

The [Electron acceptance script](../../tests/desktop/verify-asset-actions.mjs)
uses a temporary profile and authenticated HTTP. Windows can retain temporary
profile files while Chromium holds them open; the script reports the profile path
when cleanup cannot finish. It verifies metadata-only show,
starter idempotency without downloads, missing IDs, invalid requests and stale
revision failures. It normalizes and uses real PNG, WAV and cube LUT files, checks
one-step undo/redo, repeat-use media reuse, placement modes, Music gain, licence
deduplication and optional credits. On Windows it also registers the installed
Arial font without copying that font into this repository.

Generation acceptance uses the real provider engine and browser normalization
with fixture transport. A PCM response becomes a playable 0.5-second WAV. A
second provider response fails, preserving the first take. An invalid MP3 take
remains in the catalogue as an original and is inspectable through HTTP show.
The script records exact request bodies and verifies that generation leaves the
project revision unchanged. Unconfirmed and malformed generation requests fail
through HTTP before provider work. No credentials are changed and no paid
provider requests are made.

The [JSON evidence](asset-actions-runtime.json) contains observed values; the
[editor screenshot](asset-actions-editor.png) shows the resulting project.
Reproduction uses the repository's Electron acceptance workflow:

```powershell
vp run build:desktop
vp exec --filter @sidecut/web vp dev --host 127.0.0.1 --port 4270 --strictPort
# In another terminal:
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
vp exec --filter @sidecut/desktop electron ../../tests/desktop/verify-asset-actions.mjs
```

## Compatibility limits

- Assets use the shared browser SQLite/OPFS library. Project resources are local
  copies, including shared-library assets; native referenced-in-place paths,
  APFS copy behavior and headless asset operations are not added. `file` and
  `original` are library filenames rather than native absolute paths.
- Resource preparation can leave cached files or registered fonts after an
  interrupted operation; the project only changes when its edit commits. Undo
  restores project data and retains reusable cached resources. Installed font/LUT
  credits follow project provenance, without native filesystem existence checks.
- Title and transition library assets are not installed by `assets-use`.
  Existing template and transition commands remain separate. Animated media
  retains the browser renderer's existing format and duration bounds.
- Live paid generation, music/vocal service output, provider permissions and
  network cancellation are not retested against paid services. Existing provider
  tests cover request formats, permission failures and preservation on
  cancellation. New generation acceptance uses fixture transport only. Browsers
  retain the existing 64 MiB asset and 32 MiB font limits.
- Packaged installations and native macOS/Linux parity remain unverified.
