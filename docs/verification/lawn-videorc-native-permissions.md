# LV006: Desktop capture devices and permissions

LV006 is implemented with Windows Electron acceptance using synthetic devices. This phase enables the existing short recorder in the desktop app; it does not implement the sustained FFmpeg engine in LV007. The five-minute/128 MiB limit and exclusion of system audio remain.

## Behavior

Project media → Record offers camera and microphone inputs alongside System default. Selected devices use exact constraints: a missing device produces an error rather than silently switching inputs. Enumeration refreshes on device changes, rejects stale results, and retains selected devices when the controls remount. Missing or ended requested tracks stop capture and release acquired tracks.

The sandboxed preload exposes only named capture prepare/release operations. Main validates the sender, frame, request ID and requested source. Camera/microphone access requires a host confirmation; screen/window capture uses a host source chooser and rechecks the selected source after selection. Microphone permission for screen capture is withheld until source selection succeeds. Access to unrelated permission types remains denied.

Grants belong to one recording and its approving main frame. Pending approvals expire after 60 seconds; approved grants expire after 310 seconds. Stop, cancel, failure, navigation and renderer loss revoke the grant. A late approval cannot restart a cancelled recording. Revocation denies further device requests; the renderer recorder owns stopping its acquired tracks.

## Recorded acceptance

The [production Electron report](lawn-videorc-native-permissions.json) exercises the actual sandboxed preload, permission handlers and renderer controls:

- Device requests are denied outside capture, and microphone permission cannot authorize a camera request.
- Duplicate requests, foreign senders, cancelled approvals, cancelled/stale pickers and removed sources are rejected.
- Screen selection is used once; navigation revokes permissions; simulated OS denial is reported.
- The app's microphone controls produce a nonempty WebM. Its SQLite metadata and chunk byte count survive an accepted reload and the record appears in Saved recordings.

The initial reload assertion failed because Electron refused navigation while the completed recording was retained. The fixture now explicitly accepts the unload and awaits `did-finish-load`, then compares metadata before and after navigation. No recording-storage change was needed.

Focused tests also cover pending/active grant deadlines, replacement documents, renderer crashes, stopped tracks, exact device constraints, missing requested tracks and cancellation during host approval. The full check passes 566 tests across 118 files, formatting, lint and TypeScript.

## Limits and reproduction

Camera/microphone devices, OS permission status and source selection are synthetic in the Electron fixture. It does not certify a physical picker, privacy-settings interaction, unplugged hardware, or macOS/Linux capture. An earlier synthetic video run threw `NotSupportedError` from `MediaRecorder.start()` in this Electron environment; desktop video encoding remains unverified. Capture errors release devices and retain already committed chunks when available. LV003/LV005 physical gates remain open, and LV007/LV034 need their own output/platform evidence.

```powershell
vp run check
vp run build:desktop
vp run verify:capture-desktop
vp run verify:recording-desktop
```

The runner uses a disposable profile and removes it after the owned Electron process exits. No physical camera, microphone, desktop pictures or private capture media are retained. Electron rejected-handler messages are expected for the negative cases. No dependencies were added.
