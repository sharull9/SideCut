# Tandem schema fixtures

`pinned-inventory.json` records all 51 edit commands, 34 project operations,
11 asset/segment operations, 43 MCP tools, 15 effects and 8 transitions from
commit `735a9b8e162c1f951044baa892d94993869f2e77`. The capture script checks the
checkout revision before extraction. Inventory coverage does not establish
semantic parity; see [the final audit](../../../docs/verification/phases-136-140.md).

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
- `project-queries.json`: synthetic requests and baseline results for status,
  media, timeline and clips, based on `TandemAPI/ServiceTypes.swift` and `Diff.swift`
  at the same revision. It does not certify complete text/summary parity.
- `service-operations.json`: synthetic success/malformed request pairs for all
  21 operations in phases 121-125, with expected result keys. Source contracts
  are `ServiceTypes.swift`, `Diff.swift`, `Wait.swift`, `Join.swift`,
  `Captions.swift`, `Short.swift` and `SectionCards.swift` at the pinned revision.
  Core/host tests and `verify-service.mjs` supply the behavioral checks. This
  matrix does not claim complete result or macOS numerical parity.
- `filmora-basic.wfp`: synthetic ZIP with project info and a single locked video
  track. Its clip lasts two seconds, starts at source second one and runs at 2x.
  The speed uses Filmora's structured `speedParam` curve and trailing 1x marker.
  `interchange.test.ts` constructs the equivalent container in memory. The source
  path `/FIXTURE/camera.mov` is intentionally missing; there is no footage in it.

These are schema/round-trip fixtures, not evidence that rendering, editing,
cross-reference validation, or loading in the macOS app already works. Those
belong to later phases. Future fields must survive round trips; unknown content
variants must reject rather than disappear.

# Review and library adapters

`review-library.json` pins 20 SideCut baseline requests derived from the reference
revision `735a9b8e162c1f951044baa892d94993869f2e77`, plus a synthetic comment/subframe
project. Its results are tested locally rather than recorded from upstream.
Archive/relink and offline/paid gates have explicit SideCut transport differences.
See [phases 126–130](../../../docs/verification/phases-126-130.md) for acceptance limits.
