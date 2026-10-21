# Tandem schema fixtures

These synthetic JSON files were authored for SideCut from the wire format and
defaults in `Sources/TandemCore/Model.swift`, `Persistence.swift`, and `Time.swift`
at [Tandem revision 735a9b8](https://github.com/mikecann/tandem/tree/735a9b8e162c1f951044baa892d94993869f2e77).
They contain no private footage, credentials, or copied user projects. Source
paths are illustrative and do not identify real files. The timing implementation
ports the referenced Swift arithmetic. See [the upstream MIT licence](TANDEM-LICENSE).

- `empty.json`: revision 0, schema 2, project ID `prj_empty`, no tracks/media,
  zero timeline duration. Missing settings default to 3840x2160, 30/1 fps,
  48 kHz, -14 LUFS master, -1 dBTP ceiling, -20 LUFS speech, Rec.709.
- `mini.json`: revision 7, schema 2, project ID `prj_mini`, 1280x720,
  30000/1001 fps, three media references, five standard video tracks, three
  standard audio tracks, and a two-second timeline. Camera/voice share
  `link_take` and source start 0.5 seconds. All five content variants appear.

These are schema/round-trip fixtures, not evidence that rendering, editing,
cross-reference validation, or loading in the macOS app already works. Those
belong to later phases. Future fields must survive round trips; unknown content
variants must reject rather than disappear.
