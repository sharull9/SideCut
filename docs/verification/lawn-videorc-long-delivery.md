# LV009 long-form delivery acceptance

The production Windows Electron run passes all recorded gates. Run `node scripts/verify-long-delivery.mjs` against the rebuilt desktop artifact. It uses an isolated profile, no padding and no physical capture. See the [machine-readable report](lawn-videorc-long-delivery.json).

The fixture imports a 612-second moving-video source with three distinct color bands and 330/660/990 Hz audio segments. It rearranges the source into three video and three processed audio clips, adds a text overlay and two-second fades, then exports the nonzero 1–611 second range through the production H.264 queue. Compressor, voice cleanup and limiter processing are enabled.

FFprobe measured a 610.021-second H.264/AAC output. Seven sampled positions decoded to distinct frames and nonzero audio. Independent comparisons identify the expected blue/red/green segment order and dominant 990/330/660 Hz tones. RMS windows immediately before and after each internal cut are below 30% of the sustained level, establishing both fades at their range-relative times. The output duration is within 0.1 seconds of the selected range.

Export took 139 seconds. Sampled Electron working set peaked at 1,119,436 KiB; profile disk use peaked at 75,309,868 bytes, below the fixture's 4 GiB thresholds. These are sampled observations and exclude system-wide peaks and external encoder memory. This accelerated synthetic output does not establish physical capture, general production throughput or a measured 60-minute recording.
