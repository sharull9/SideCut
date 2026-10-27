# LV010 rendered review acceptance

The production Electron run passed all recorded checks on Windows using synthetic media. Run `vp run build:desktop` followed by `vp run verify:rendered-review` to reproduce it in an isolated temporary profile.

The fixture exports a nonzero timeline range at 30000/1001 fps, saves revision A as a review version, decodes and plays the retained video, and adds point and range feedback with source-clock mapping. It exercises replies, resolution and reopening, then exports revision B through the native H.264 queue and publishes its MP4 artifact. Both the WebM and MP4 artifacts decode and play. Revision A metadata, SHA-256 artifact identity and feedback remain unchanged; version B has separate threads. A second Electron process reopens the same profile and verifies both versions, artifact hashes, feedback isolation and decoded playback.

The [machine-readable report](lawn-videorc-rendered-review.json) contains the results. The fixture confirms publication through the UI and inspects stored versions independently through the production storage bridge. The launcher shuts down normally between processes so the host project lock is released.

This is local review acceptance. Hosted sharing, tenant access, guest permissions and physical-media calibration belong to later phases.

Integration validation passed: formatting, lint without warnings, all package TypeScript checks, 613 tests across 128 files, and the desktop production build.
