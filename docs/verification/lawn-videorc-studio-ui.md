# Live studio controls

Recorded 2026-11-01 on Windows. Run `vp run build:web`, then `vp run verify:studio-ui`. Results are in [lawn-videorc-studio-ui.json](lawn-videorc-studio-ui.json). The same journey was also exercised by hand in the development preview browser, except for devices, which that browser denies.

## What shipped

The editor's **Studio** button opens a production dialog that drives the existing LV016–LV019 models. Saved scenes are stored per project in origin-private storage.

| Area    | Controls                                                                                           |
| ------- | -------------------------------------------------------------------------------------------------- |
| Scenes  | Save from editor, explicit switch, update, remove; the live scene cannot be removed                |
| Look    | Background, colors, motion, banner/takeover/highlight overlays; saving does not change live output |
| Sources | Camera picture-in-picture and screen capture composed into the program                             |
| Audio   | Microphone meter, gain, mute, monitor, sync delay, rumble removal, soundboard files                |
| Output  | Program recording and 30/60-second recent clips, with add-to-project, download and discard         |

## Checks that passed

Production build in Chromium with synthetic devices:

- Scene saves stay off air until switched, and the switched overlay reaches program pixels.
- The fake camera reaches program pixels.
- The microphone meter reads 1.0 and drops to 0 when muted.
- A recorded take decodes at 1920×1080 with an audio track and the overlay color.
- Takes import into Project media.
- A recent clip saves with its mark count.
- Closing is blocked while output is unsaved.
- Scenes and the live look recover after reload.

## Defects found and fixed

- A 4K project froze the browser while recording. Browser program output is now capped at 1080p, and that take grew from 79 KB with blank samples to 6.8 MB with correct pixels.
- Opening Studio while a project was loading bound scenes to a placeholder project ID. The button now waits for the project.
- A 4K canvas could size the dialog layout. It is now positioned independently of its output size.
- Convex connections failed on a `//api` URL, so Teams never connected. The URL now has no trailing slash.
- Closing Teams crashed the whole editor because the Convex client closed before its subscribers. It now closes afterwards.
- Teams ignored Convex's forced token refresh requests. It now honors them.

## Limits

- Devices are synthetic. The screen source used Chromium's automatic tab capture, so the real OS picker, physical camera/microphone and A/V calibration remain unverified.
- Browser output is capped at 1080p30. A 4K program needs the native recorder path, which is not connected to the studio.
- Takes are held in memory up to 128 MiB and are lost if the tab crashes. They do not use durable recording storage.
- Recent-clip marks are counted in the UI but do not become timeline markers.
- A scene's timeline keeps advancing on the studio clock, so it does not loop when its project content ends.
- Recording recovery after a crash, native routing and gapless native clips remain open.

LV016–LV019 stay in progress because their native and recovery requirements are not met.
