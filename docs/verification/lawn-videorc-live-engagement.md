# LV024–LV026 live engagement

Continued the approved phase plan on 2026-10-31. These phases remain in progress: the core and browser compositor work below does not establish provider, hosted speech, UI or native acceptance.

## LV024: chat and audience

`LiveChat` consumes normalized adapter events for YouTube, Twitch, Kick and X. These provider names are namespaces, not claims of connected provider support. There are no network chat adapters, emote-image downloads or remote moderation operations in this slice. Hiding removes a local message; it does not ban a viewer or delete a provider message.

The feed retains 500 messages, 1,000 deduplication keys and 1,000 audience events. IDs are scoped by provider. Emote ranges use JavaScript UTF-16 offsets and are validated for ordering and bounds; rendering currently uses plain text. Replays within the deduplication window are ignored, including hidden messages. Older evicted IDs can be accepted again. Follow/subscription/raid events are retained; newer viewer samples supersede older ones; late older samples are ignored. Counts are per provider and unknown after disconnect, not a deduplicated cross-platform audience total.

Each connection receives a generation. Old disconnect callbacks cannot close a newer connection; stale, disconnected and quota-paused deliveries are rejected. The adapter owns network reconnect/backoff and authorization. Selected messages become plain-text canvas banners through the existing overlay painter. Removing/evicting a selected message clears its highlight. No chat text is interpreted as HTML, an instruction or a posting command.

## LV025: live captions

`LiveCaptions` validates against the existing `TranscriptWord` semantics, with ordered source timestamps on the studio clock. Updates contain a stable segment ID, increasing revision and partial/final flag. Newer partials replace earlier text; final segments cannot be overwritten by late partial/final replays. Each update is bounded to 200 words of 200 characters each, and the buffer retains 200 segments. This buffer is for live presentation, not a durable full-session transcript.

Disconnect/reconnect clears unfinished partials, retains finals and rejects old transport generations. The latest accepted update records observed delivery latency from its last word end to receipt; this is not measured speech-model latency. Default routing enables preview only. Routing can independently enable record and stream; each target must use a separate `LiveStudioOutput` canvas when policies differ. A canvas capture always contains everything painted onto that canvas. Captions expire 1.5 seconds after each word ends and rendered text is bounded to 500 characters.

The browser output takes optional engagement state and paints it on the staging canvas before complete-frame publication. No batch speech model is presented as a streaming backend. No hosted requests are made. Hosted speech depends on LV029/LV030 consent/service work; physical speech quality, network latency and native output routing remain open.

## LV026: companion appearance

`LiveCompanion` holds up to 20 validated profiles with a name, color, orb/robot/cat avatar and motion preference. The avatars are original procedural canvas shapes drawn for SideCut; no third-party images, brand assets or licenses are imported. The serialized library preserves profile settings but excludes activation and transient reactions. Restoring requires explicit activation again. Removing the active profile deactivates it.

Happy and surprised reactions last two seconds. Animated profiles receive a small 250 ms scale response; static profiles and reduced-motion users receive the expression without motion. Changing the active profile clears the prior reaction. The companion painter uses the same completed-frame output as highlights and captions. There is no autonomous behavior, posting, microphone access or cloud activation.

Profile APIs and painting are implemented. Onboarding, library selection controls, external/custom licensed asset import and native/production UI acceptance remain open.

## Verification

`packages/core/src/live-engagement.test.ts` covers replay/provider isolation, hidden messages, stale generations, quota disconnects, retention/eviction, stale viewer counts, malformed emote ranges, partial replacement, immutable finals, output routing, observed latency, reconnect, invalid word clocks, activation, restore, reduced motion, reaction expiry, invalid profiles and library limits.

`vp run verify:live-engagement` launches headless Chromium against actual workspace modules. For each preview/record/stream target it renders a scene, highlights chat, activates the companion, captures VP8 with MediaRecorder, decodes and seeks the recording, and samples pixels. It verifies captions only in the enabled preview target, highlights and companions in every target, removal in subsequent frames and capture-track teardown. The script uses normalized synthetic events and no external accounts or speech service. The [JSON evidence](lawn-videorc-live-engagement.json) contains sampled and decoded pixels, sizes, status and observed fixture latency. Headless verification is not a production controls/visual review.

`vp run check` passed formatting, lint, all workspace typechecks and 679 tests across 143 files. `vp run build:desktop` passed. Root validation and desktop build logs are `logs/lv024-026-check.log` and `logs/lv024-026-build.log`. The build does not imply that optional engagement APIs are wired into the editor UI or native recorder.
