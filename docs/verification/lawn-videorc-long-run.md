# LV009: Long native recording run

`scripts/verify-native-long-run.mjs` runs a 60-minute wall-clock synthetic capture with a tone input first, a 1920-by-1080 test pattern at 30 frames per second, H.264, AAC, MKV clusters, packet flushing, and the native recorder's bounded input queues and two encoder threads. It then remuxes to MP4 and checks the resulting streams with FFprobe.

The [machine-readable report](lawn-videorc-long-run.json) records status, minute samples of output size, encoder CPU and Windows working set and private memory, and Node memory. A pass requires the full requested wall time, H.264/AAC streams, 1080p video, at least 29 video packets and over 40 audio packets per requested second, duration and wall-time tolerances, and A/V start and end differences within 250 ms. Child processes have deadlines and logs are bounded. Controlled failures and interruptions are recorded as such. An abruptly terminated runner can leave a stale running status; verify the process and last sample before interpreting it.

The [37-minute interrupted report](lawn-videorc-long-run.interrupted-2221s.json) preserves the last sample at 2221.032 seconds; its encoder and runner were absent when checked. The [first full-duration attempt](lawn-videorc-long-run.failed-wall-time.json) failed the minimum wall-time assertion after FFmpeg exited successfully. Its last sample was at 3541.277 seconds. That runner did not retain the final capture wall time or FFprobe results, so this attempt is not a pass.

The [previous interrupted report](lawn-videorc-long-run.interrupted.json) preserves its last sample at 180.594 seconds; it is not a pass.

```powershell
node scripts/verify-native-long-run.mjs
```

`SIDECUT_LONG_RUN_SECONDS` permits shorter development runs, which do not meet the 60-minute requirement. This is synthetic, direct FFmpeg evidence (`production: false`); it does not establish physical-device timing, device-loss recovery, Electron IPC, or recorder journal recovery.

The corrected runner targets five additional seconds of media because buffered real-time inputs can reach a media-time cutoff before the matching wall duration. The minimum wall-time assertion remains strict. It records final elapsed time and FFprobe data before that assertion; probe drift is compared with the explicitly recorded media target. Development runs use `lawn-videorc-long-run-development.json`, preserving the full-duration evidence.

The corrected [full-duration report](lawn-videorc-long-run.json) completed and qualifies for hour acceptance: capture wall time was 3604.7023421 seconds; media duration was 3605.035 seconds against a 3605-second target (0.035-second drift). FFprobe found 1920 × 1080 H.264 at 30 fps with 108,150 packets and AAC with 168,986 packets. A/V start and end differences were 0.021 and 0.007 seconds. Across 61 samples, maximum encoder working set was 229,031,936 bytes and private memory was 277,540,864 bytes; maximum Node RSS was 48,168,960 bytes. The remuxed file was 2,479,536,157 bytes. These are sampled process observations, not system-wide peaks.
