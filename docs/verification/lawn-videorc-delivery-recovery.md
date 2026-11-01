# LV009 delivery recovery acceptance

The production Windows Electron fixture passes rendering, native encoding and publication recovery. Run `vp run verify:delivery-recovery` against the rebuilt desktop artifact. It uses an isolated profile and synthetic media, without physical capture. See the [machine-readable report](lawn-videorc-delivery-recovery.json).

The fixture observes a running durable export, abruptly terminates Electron, and reopens the same profile. It restores the interrupted job, retries its unchanged recipe, and decodes/plays the completed output. A subsequent process-tree termination occurs while FFmpeg is encoding a managed immutable input. On restart, the encoding journal is failed, its partial is removed, and the ready input retains its SHA-256 through restart and a separate invalid-input encode.

Publication recovery uses deterministic fault injection confined to the fixture: it holds the filesystem link call after the native output has been fully encoded, synced, inspected and journaled as verified. The runner terminates the actual process tree at that barrier. A fresh process, without the barrier, reconciles the verified output to published. Its bytes match the pre-termination hash, it decodes and plays as MP4, and the previous ready output remains unchanged. This is a controlled boundary fault, not a probabilistic observation of an unmodified publication race.

NativeProjectStore now reclaims a validated dead-owner lock under a SQLite operating-system recovery guard. Live owners, unreadable locks and ambiguous PID checks stay protected. Regression tests cover dead/live owners, malformed locks and competing reclamation. PID reuse conservatively blocks rather than taking another process's lock.

The native interruption uses a managed immutable file, rather than demonstrating interruption of a second resource-bearing queued project. Rendering recovery covers frozen queued recipes; further combinations can expand coverage. Synthetic checks do not establish physical-device recovery or a 60-minute recording.
