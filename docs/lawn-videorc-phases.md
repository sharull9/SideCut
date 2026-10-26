# Lawn and Videorc implementation phases

The [integration plan](lawn-videorc-parity-plan.md) defines the design, scope and pinned sources. These phases execute that plan on SideCut `34dc3d8`. Existing Tandem phase numbers remain unchanged. The user authorized phase creation and implementation on 2026-10-26.

Statuses: `[ ]` pending, `[-]` in progress, `[x]` implemented with recorded checks. Each phase needs its own acceptance result. Full parity is not claimed by finishing the first release.

## Recording into the editor

- [x] **LV001. Browser capture lifecycle.** Detect screen/camera/microphone and WebM recorder support. Request devices only after Start. Stage ordered recorder chunks locally, bound duration/file size/pending writes, and release every acquired track on failure, cancel or source-ended. Lifecycle tests and real MediaRecorder artifacts pass within the [recorded synthetic-device limits](verification/lawn-videorc-capture.md).
- [x] **LV002. Capture-to-project controls.** Add a recording section to Project media using current controls. Retain the completed file until import or explicit discard. Bind import to the original project, respect read-only/busy state, allow retry/download and keep existing import/undo/persistence. Production record/import/place/reload and failed-save retry checks pass.
- [-] **LV003. Capture acceptance and recovery.** Automated permission failure, source stop, cancellation during permission prompts, storage errors, project replacement and unsupported capability checks pass. Physical device/OS screen-picker, accepted-navigation cleanup and cross-browser capture acceptance remain open. Desktop capture stays explicitly disabled. Crash-resumable partial recordings remain a later storage phase.
- [ ] **LV004. Recording storage for long sessions.** Reuse SQLite/OPFS and host resources; add file-backed paths beyond current limits, recording metadata, output-directory selection and disk-full recovery. Accept with interrupted-write/restart and large-file fixtures.
- [ ] **LV005. Native capture feasibility.** Measure Windows screen/microphone capture, A/V sync and frame cadence at 1080p30. Compare current host/FFmpeg with a private worker and record the engine decision. No new worker language is assumed before evidence.
- [ ] **LV006. Native devices and permissions.** Add capture-specific host/preload operations and device lifecycle. Keep existing sender checks and permission denial outside explicit capture. Test device removal and stale requests.
- [ ] **LV007. Sustained native recording.** Implement the chosen capture engine, MKV recovery, MP4 remux, hardware encoding/fallback and timed camera/screen/audio outputs. Inspect actual files and retain failed finalization metadata.
- [ ] **LV008. Recording library and editor handoff.** Add recording rows, posters, reveal/delete/import, source offsets and one-step project creation. Reuse current resource/archive/relink services.
- [ ] **LV009. Durable long-form delivery.** Extend export/file limits and persistent queues. Reuse H.264/HEVC/presets. Accept with complex long-form A/V output, resource bounds and a measured 60-minute capture.

## Review and cloud library

- [ ] **LV010. Review versions and threads.** Add immutable rendered versions, author/reply/resolution state and time mapping. Preserve local marker and agent-review behavior. Test that later edits cannot move historical feedback.
- [ ] **LV011. Review player and handoff.** Reuse transport/navigation, fill shuttle/theater gaps, add filters, safe CSV and explicit feedback-to-marker conversion. Test frame mapping and formula-safe CSV.
- [ ] **LV012. Cloud identity and teams.** Select provider/region/budget, implement tenants, invitations and roles. Test cross-tenant and role authorization before media delivery.
- [ ] **LV013. Cloud library and uploads.** Add folders, sort/search/selection/bulk actions, multipart transfer, thumbnails and retry-safe processing. Verify duplicate/out-of-order events and failed uploads.
- [ ] **LV014. Versioned hosted playback.** Publish immutable render versions and retain the prior ready version during upload/transcode failures. Test playback authorization as well as metadata.
- [ ] **LV015. Share grants and guest review.** Add public/private/password/expiry/download policies, comments, presence and workflow state. Verify revocation, old-version isolation and concurrent replies.

## Live studio

- [ ] **LV016. Scene model and switching.** Share geometry with editing, add saved live scenes/transforms/masks and revisioned scene commits. Preview and recording must show the same revision.
- [ ] **LV017. Live assets.** Add backgrounds with ten animated equivalents, saved looks/motion, banners, takeovers, highlights and overlay ordering. Verify preview/record/output parity.
- [ ] **LV018. Live audio.** Add input meters, gain/mute, monitor routing, sync offset, cleanup and soundboard using existing assets/processing where appropriate. Test loopback and A/V alignment.
- [ ] **LV019. Recent clips and source recovery.** Add 30/60-second save actions, bounded buffer-only capture, markers and clip marks. Test rearm, old source-failure latches and separate-source configurations.

## Streaming and platform integrations

- [ ] **LV020. Single destination.** Add RTMP/RTMPS plus local recording. Verify against a local listener without external publication.
- [ ] **LV021. Multistream isolation.** Add per-target queues, health, retry and independent stop. Failed targets cannot block recording or healthy targets.
- [ ] **LV022. Horizontal and vertical output.** Add independent live compositions/renditions and quality profiles. Do not imply one encode can serve incompatible output settings.
- [ ] **LV023. Provider accounts.** Add YouTube, Twitch, Kick and X separately, with credentials, metadata, scheduling, thumbnails, quota handling and tested lifecycle. Other platforms begin as custom RTMP where permitted.
- [ ] **LV024. Chat and audience.** Add unified chat, emotes, viewer events/stats, moderation and highlight overlays. Record per-provider supported behavior and test disconnect/quota paths.

## Intelligence and hosted services

- [ ] **LV025. Live captions.** Add streaming partial/final speech and per-preview/record/stream caption targets. Reuse offline word/caption models; measure latency and reconnection.
- [ ] **LV026. Companion appearance.** Add profile/library, static/animated avatars, reactions, overlays and onboarding. Preserve asset licenses and explicit activation.
- [ ] **LV027. Companion behavior.** Add templates/welcomes, questions/drafts, flags/promises, controlled posting, commands, clips and reports. Test consent, per-kind disable, deduplication, rate limits and suggest-only mode.
- [ ] **LV028. Derived edits.** Add reviewable clean/condensed/noise-cleaned jobs using existing edit commands, retained originals and retimed subtitles. Test retries and one-step undo.
- [ ] **LV029. Hosted AI/publish contracts.** Specify available publish-pack outputs and implement SideCut-owned gateway/job services with consent and resumable processing. Client contracts alone do not prove server parity.
- [ ] **LV030. Commercial/account operations.** Add server-side usage, quotas, entitlements, subscription events, retention, deletion and export. Test duplicate billing events and partial-job accounting.

## Remote controls and release acceptance

- [ ] **LV031. Studio automation.** Extend existing ProjectAPI/SDK/CLI/MCP actions with recording/scene control. Preserve idempotency, revisions, authors, leases and cancellation.
- [ ] **LV032. Phone and deck control.** Add local shortcuts/deck actions, restricted LAN pairing, signed intents and per-device revoke. Never expose the general-purpose local service to LAN clients.
- [ ] **LV033. OBS import.** Reuse current import/resource handling; implement a documented scene/profile subset with unsupported-source diagnostics.
- [ ] **LV034. Native platform acceptance.** Add macOS/Linux capture and install evidence, extend Windows checks, and distinguish physical devices from synthetic/container runs.
- [ ] **LV035. Distribution and certification.** Complete signing/updates, repair, diagnostics, redacted support, migrations and complete capture/edit/live/review/delivery journeys. Publish evidence per pinned feature/platform/provider.

## Dependencies and checks

LV001–LV003 are the first executable slice. Browser capture can begin before the larger native-storage work. LV004–LV009 build native recording. LV010–LV015 can proceed independently once review contracts are settled. LV016–LV019 depend on the native engine; LV020–LV024 depend on live output. Hosted portions of LV025–LV029 require the gateway/consent subset of LV029–LV030. LV031 extends existing adapters; it does not recreate them.

Run targeted tests for each phase, then `vp run check` and the affected build. Use existing production browser and desktop scripts for workflow acceptance. Use fake devices/local RTMP/test providers for routine verification; real accounts, paid AI and publication need separate integration evidence. Record exact pass/failure/limits in `docs/verification/lawn-videorc-capture.md` for the first slice and analogous reports thereafter.
