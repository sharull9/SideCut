# LV021–LV023 implementation and acceptance limits

Continued the approved phase plan on 2026-10-31. All three phases remain in progress.

## LV021: multiple native destinations

The host accepts either the legacy `streamURL` or `streamURLs` with one to four distinct RTMP/RTMPS URLs. Conflicting fields, duplicates, invalid URLs and oversized lists fail before device access. Confirmation names every host while omitting keys. Destinations never enter the recording journal. Existing main-document ownership also protects per-target status.

Each tee slave has its own 120-packet FIFO, overflow drops, three recovery attempts with one-second waits, restart at a keyframe, and a three-second network timeout. Local MKV remains mandatory; network slaves use failure-ignore. This bounds packets, not total bytes/process memory. Encoded output is shared, so destinations currently need compatible media settings.

Status contains target indices and observed failures, never endpoints. `requested` does not prove delivery; `failed` records an observed opening/slave failure and can remain after automatic recovery. There is no provider receipt or recovered-health claim. Independent stop needs a different transport/process topology and remains open.

The real FFmpeg loopback fixture now starts a healthy RTMP destination alongside a refused destination. It checks target failure attribution, healthy-target status, decoded received/local H.264/AAC output, duration agreement and secret-free journals. Existing RTMPS trust, wrong-host and untrusted-certificate checks remain.

## LV022: independent compositions

`LiveStudioRenditions` owns separate horizontal and vertical `LiveStudio` instances. Saving validates orientation and the existing 4K pixel ceiling. Each output has independent saved scenes, active composition and revision conflicts. Tests verify different geometry and isolated revisions. Standard/high profiles define 30/60 fps and 4/8 Mbps video with 128/192 kbps audio.

These are core APIs and profile definitions. They are not connected to output controls or separate encoders yet. Simultaneous browser/native rendition recordings and decoded cadence/quality acceptance remain open. LV021 tee output still shares one encode.

## LV023: first provider adapter

`TwitchBroadcastAccount` is a host-only adapter, not exposed over IPC. It retrieves the authenticated broadcaster's stream key from the fixed Helix API, validates Twitch ingest destinations, and updates channel titles. Credentials stay in host memory. Disconnect clears the token and aborts requests; requests time out after ten seconds, reject redirects, redact response bodies and classify expired authorization and rate limits. No mutations are automatically retried. Local HTTP fixture tests cover retrieval, title updates, disconnect, 401/403/429/500 and rejected ingest hosts.

OAuth acquisition, secure refresh-token storage, UI/IPC integration, external account acceptance and scheduling/thumbnails remain open. YouTube, Kick and X adapters have not been implemented. No accounts were connected and no external broadcast was started.

Official sources reviewed:

- [Twitch reference](https://dev.twitch.tv/docs/api/reference/): Get Stream Key requires the broadcaster's `channel:read:stream_key` authorization; Modify Channel Information uses `channel:manage:broadcast`.
- [YouTube broadcasts and streams](https://developers.google.com/youtube/data/live/guides/implementation/broadcasts-and-streams): distinct broadcast/stream creation and binding. [Transition](https://developers.google.com/youtube/data/live/reference/rest/v3/liveBroadcasts/transition) requires an active bound stream before live/testing transitions.
- [Kick scopes](https://github.com/KickEngineering/KickDevDocs/blob/main/scopes/scopes.md): OAuth grants include `streamkey:read`; implement against its current official schema rather than private endpoints.
- [X Media Studio Producer](https://help.x.com/en/using-x/how-to-use-live-producer): source/ingest and broadcast lifecycle remain separate. API availability/access must be verified before implementing an adapter; no equivalence to generic RTMP is claimed.

## Validation

Focused native streaming, IPC and studio tests: 16 passed. The streaming tests use real FFmpeg synthetic media and loopback listeners; core and IPC tests do not prove production UI behavior. Root `vp run check` passed formatting, lint, workspace typechecks and 673 tests across 142 files. `vp run build:desktop` passed. After tightening disconnect handling during response parsing, all five adapter tests passed again. Logs are recorded in `logs/lv021-023-check.log` and `logs/lv021-023-build.log`.
