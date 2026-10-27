import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { decodeProjectFile } from "@sidecut/contracts/project";
import type { ReviewVersion } from "@sidecut/contracts/review";
import { Button } from "@sidecut/ui/components/button";
import { reviewFrameTime, reviewReverseTime, reviewShuttleRate } from "./review-player-logic";

type Props = {
  url: string;
  mediaType: string;
  version: ReviewVersion;
  mediaRef: RefObject<HTMLMediaElement | null>;
  onTimeUpdate: (seconds: number) => void;
  onError: (message: string) => void;
};

export function ReviewPlayer({ url, mediaType, version, mediaRef, onTimeUpdate, onError }: Props) {
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [theater, setTheater] = useState(false);
  const shuttle = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const callbacks = useRef({ onTimeUpdate, onError });
  callbacks.current = { onTimeUpdate, onError };
  const frameRate = useMemo(() => {
    try {
      return decodeProjectFile(JSON.parse(version.source.snapshotJSON)).project.settings.frameRate;
    } catch {
      return null;
    }
  }, [version.source.snapshotJSON]);

  function stopTimer() {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }
  function pause() {
    stopTimer();
    shuttle.current = 0;
    mediaRef.current?.pause();
    setPlaying(false);
  }
  function seek(seconds: number) {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = Math.max(0, Math.min(version.source.durationSeconds, seconds));
    callbacks.current.onTimeUpdate(media.currentTime);
  }
  function play(speed: number) {
    const media = mediaRef.current;
    if (!media) return;
    stopTimer();
    shuttle.current = speed;
    if (speed < 0) {
      media.pause();
      if (media.currentTime <= 0) {
        pause();
        return;
      }
      setPlaying(true);
      let previous = performance.now();
      timer.current = setInterval(() => {
        const now = performance.now();
        const next = reviewReverseTime(media.currentTime, (now - previous) / 1000, speed);
        previous = now;
        seek(next);
        if (next === 0) pause();
      }, 50);
      return;
    }
    media.playbackRate = speed;
    const token = generation.current;
    void media
      .play()
      .then(() => {
        if (token === generation.current && shuttle.current === speed) setPlaying(true);
      })
      .catch((error: unknown) => {
        if (token !== generation.current || shuttle.current !== speed) return;
        shuttle.current = 0;
        setPlaying(false);
        callbacks.current.onError(
          error instanceof Error
            ? `Unable to play review: ${error.message}`
            : "Unable to play this review version.",
        );
      });
  }
  function step(direction: -1 | 1) {
    const media = mediaRef.current;
    if (!media || !frameRate) return;
    pause();
    seek(reviewFrameTime(media.currentTime, direction, version.source.durationSeconds, frameRate));
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])')
    )
      return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing) {
      event.stopPropagation();
      return;
    }
    // Keep editor shortcuts from acting while focus is inside the review player.
    event.stopPropagation();
    if (event.key === "Escape" && theater) {
      event.preventDefault();
      setTheater(false);
      return;
    }
    if (event.key === " " && target instanceof HTMLElement && target.closest("button")) return;
    switch (event.key.toLowerCase()) {
      case " ":
        event.preventDefault();
        if (playing) pause();
        else play(rate);
        break;
      case "arrowleft":
        event.preventDefault();
        step(-1);
        break;
      case "arrowright":
        event.preventDefault();
        step(1);
        break;
      case "home":
        event.preventDefault();
        pause();
        seek(0);
        break;
      case "end":
        event.preventDefault();
        pause();
        seek(version.source.durationSeconds);
        break;
      case "j":
        event.preventDefault();
        play(reviewShuttleRate(shuttle.current, -1));
        break;
      case "k":
        event.preventDefault();
        pause();
        break;
      case "l":
        event.preventDefault();
        play(reviewShuttleRate(shuttle.current, 1));
        break;
    }
  }

  useEffect(() => {
    const media = mediaRef.current;
    const currentGeneration = generation;
    const currentShuttle = shuttle;
    generation.current++;
    shuttle.current = 0;
    setPlaying(false);
    setRate(1);
    return () => {
      currentGeneration.current++;
      stopTimer();
      currentShuttle.current = 0;
      media?.pause();
    };
  }, [url, version.id, mediaRef]);
  useEffect(() => {
    if (!frameRate) callbacks.current.onError("Unable to read the review version's frame rate.");
  }, [frameRate]);

  const mediaProps = {
    controls: true,
    src: url,
    onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) =>
      callbacks.current.onTimeUpdate(event.currentTarget.currentTime),
    onError: () => callbacks.current.onError("Unable to play this review version."),
    onPlay: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      if (event.currentTarget.paused) return;
      stopTimer();
      shuttle.current = event.currentTarget.playbackRate;
      setPlaying(true);
    },
    onPause: (event: React.SyntheticEvent<HTMLMediaElement>) => {
      if (event.currentTarget.paused && shuttle.current >= 0) {
        shuttle.current = 0;
        setPlaying(false);
      }
    },
    onEnded: () => pause(),
  };
  return (
    <div
      role="region"
      aria-label="Review player"
      tabIndex={0}
      onKeyDown={keyDown}
      style={
        theater
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "var(--background, #111)",
              overflow: "auto",
              padding: "1rem",
            }
          : undefined
      }
    >
      {mediaType.startsWith("audio/") ? (
        <audio
          {...mediaProps}
          ref={(element) => {
            mediaRef.current = element;
          }}
        />
      ) : (
        <video
          {...mediaProps}
          ref={(element) => {
            mediaRef.current = element;
          }}
          style={{ width: "100%", maxHeight: theater ? "75vh" : undefined }}
        />
      )}
      <div className="editor-transport">
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            pause();
            seek(0);
          }}
        >
          Start
        </Button>
        <Button size="xs" variant="outline" disabled={!frameRate} onClick={() => step(-1)}>
          Previous frame
        </Button>
        <Button size="xs" variant="outline" onClick={() => (playing ? pause() : play(rate))}>
          {playing ? "Pause" : "Play"}
        </Button>
        <Button size="xs" variant="outline" disabled={!frameRate} onClick={() => step(1)}>
          Next frame
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            pause();
            seek(version.source.durationSeconds);
          }}
        >
          End
        </Button>
        <label>
          Speed{" "}
          <select
            value={rate}
            onChange={(event) => {
              const next = Number(event.target.value);
              setRate(next);
              if (playing) play(next);
            }}
          >
            {[0.25, 0.5, 1, 1.5, 2, 4, 8].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </label>
        <Button
          size="xs"
          variant="outline"
          aria-pressed={theater}
          onClick={() => setTheater(!theater)}
        >
          {theater ? "Exit theater" : "Theater"}
        </Button>
      </div>
      <small>Space: play/pause · ←/→: frame · Home/End: seek · J/K/L: shuttle</small>
    </div>
  );
}
