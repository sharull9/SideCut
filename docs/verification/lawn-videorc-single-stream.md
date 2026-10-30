# LV020 single streaming destination

Implemented on 2026-10-30 under the approved Lawn/Videorc phase plan. LV020 remains in progress because the live studio compositor is not yet routed into the native encoder.

## Native capture and local recording

`NativeRecordingRequest.streamURL` optionally sends native capture to one RTMP or RTMPS destination. Omitting the field preserves local-only recording. FFmpeg encodes once into H.264 and AAC, then the tee muxer writes the existing recovery MKV and an FLV network output. Streaming video has a 4 Mbps rate cap and an 8 Mbit buffer. Existing encoder selection and local MP4 finalization remain in place.

The network output has a separate FIFO with a 120-packet queue, overflow drops, a three-second network read/write timeout and failure-ignore behavior. The local output remains mandatory. No automatic network retry is enabled. Queue size bounds packet count, not encoded bytes or total FFmpeg memory. These settings use the documented [tee and FIFO muxers](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n7.1/doc/muxers.texi).

The session reports `off`, `requested` or `failed`. Requested means FFmpeg was asked to send the capture, not that a provider confirmed delivery. Bounded stderr inspection detects FIFO errors and tee network-slave failure without exposing diagnostics to the renderer. Stopping recording stops the stream. Independent stop, retry and multiple targets belong to LV021.

## Destination handling and controls

The existing desktop Native recording section has a masked optional destination field and explicit start/stop labels. It clears the URL after a successful start. The field is disabled during capture, and the existing refresh displays requested or failed status. A failed stream leaves local recording available. The form uses the existing Field and Input components. The design detector reported no findings.

Host IPC accepts only the trusted main document of a visible desktop window. Its confirmation names the destination protocol and host without showing the stream path or key. Confirmation still expires after navigation or renderer loss. Status is restricted to the document that owns the recording. Existing stop and shutdown handling closes both outputs.

URL validation accepts RTMP or RTMPS with a hostname and stream path. It rejects embedded login credentials, fragments, whitespace and tee delimiters, quotes or backslashes. Unsupported characters can be percent-encoded in a stream path. Destination URLs are never added to recording journals, recording-list responses or saved project settings. They remain in renderer/host memory and the FFmpeg process arguments during capture, so OS process inspection can reveal them. This is not an encrypted credential store.

RTMPS enables certificate verification and currently requires an FFmpeg build configured with GnuTLS. This restriction avoids silently accepting an unverified hostname on other backends. FFmpeg documents backend differences in its [TLS protocol options](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n7.1/doc/protocols.texi). A host-only `streamingCAFile` option supplies a PEM trust file when needed. Renderer requests cannot change trust roots or disable verification. The production host uses the binary's default trust store; local tests supply their fixture certificate explicitly.

## Local acceptance

`vp run verify:single-stream` runs six tests using the real native recording class, FFmpeg 6.1.1 with GnuTLS and synthetic video/audio on Windows. All listeners bind loopback addresses. The trusted RTMPS test uses a Node TLS proxy into an FFmpeg RTMP listener, with backpressure through normal socket pipes. It does not use a platform account or publish externally.

Both received and local recordings pass ffprobe codec/duration checks and full FFmpeg decode. The RTMP and trusted RTMPS received durations agree with the local recording within 0.5 seconds. Connection refusal, an untrusted certificate and a trusted certificate with a mismatched hostname all preserve a playable local MP4. Validation tests reject protocol and tee injection. The generated [JSON evidence](lawn-videorc-single-stream.json) records durations, codecs, byte counts and failure results. Temporary recordings are removed after the checks.

Two additional IPC tests verify destination validation before device access, redacted host confirmation, request forwarding and status ownership. Existing native recorder and IPC lifecycle tests also pass. The UI source passes lint and typechecking; no production UI interaction or visual capture is claimed here.

Final validation passed `vp run check`, including formatting, lint, all workspace typechecks and 666 tests across 141 files. `vp run build:desktop` passed for the production web assets, Electron main process and preload. Local logs are `logs/lv020-check.log` and `logs/lv020-build.log`.

## Remaining acceptance

The native capture path sends the selected screen, camera or microphone. It does not yet consume LV016's browser studio composition or LV018's audio mix. Provider-specific ingest profiles, physical device capture, sustained networking, bandwidth changes, reconnect behavior, default public CA stores on shipped installations and other operating systems remain unverified. This work does not complete multistream isolation or provider-account integration.
