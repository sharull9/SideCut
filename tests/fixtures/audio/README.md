# Speech fixture

`speech.wav` is the first eight seconds of the American English recording
`OSR_us_000_0010_8k.wav` from the **Open Speech Repository**, sponsored by Telchemy
Incorporated. Source: https://www.voiptroubleshooter.com/open_speech/american/OSR_us_000_0010_8k.wav

The [repository's conditions of use](https://voiptroubleshooter.com/open_speech/about.html)
permit copying, publishing, modifying, and incorporating its recordings into
development and testing, with source identification. This fixture is attributed
to the Open Speech Repository. It contains public testing speech, not user media.

Derived with `ffmpeg -i original.wav -t 8 -ar 48000 -ac 1 speech.wav`.
This changes sample rate from 8 kHz to 48 kHz without claiming new bandwidth.
SHA-256: `6744d700dd34269d6f3032bc8e32630f7943a774192e01670111c5adfea0b82d`.
Verification adds deterministic synthetic noise in memory; the clean fixture is
retained for speech correlation and frequency-band comparison.
