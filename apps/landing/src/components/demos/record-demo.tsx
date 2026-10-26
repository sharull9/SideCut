import { RiCameraLine, RiCheckLine, RiComputerLine, RiMicLine } from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useDemoLoop } from "@/lib/use-demo-loop";
import { LogoMark } from "../logo";
import { Cursor, Panel } from "./parts";

// idle, screen, camera, mic, cursor travels, recording, saved
const STEPS = [900, 550, 550, 550, 900, 2600, 2000] as const;
const SOURCES = [
  { label: "Screen", icon: RiComputerLine },
  { label: "Camera", icon: RiCameraLine },
  { label: "Mic", icon: RiMicLine },
] as const;

export function RecordDemo() {
  const { ref, step } = useDemoLoop(STEPS);
  const recording = step === 5;
  const saved = step === 6;

  return (
    <div ref={ref} className="relative flex h-full items-center justify-center">
      <Panel className="w-[78%] max-w-[300px] p-3">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-ink text-white">
            <LogoMark className="size-4" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-[11px] font-semibold">raE.E</p>
            <p className="text-[9px] text-ink-faint">Recorder</p>
          </div>
          <StatusPill recording={recording} saved={saved} />
        </div>

        <motion.div
          className="relative mt-3 flex h-9 items-center justify-center overflow-hidden rounded-lg text-[11px] font-medium text-white"
          animate={{
            backgroundColor: recording
              ? "oklch(0.62 0.21 27)"
              : saved
                ? "oklch(0.5 0.15 150)"
                : "oklch(0.6 0.17 150)",
            scale: step === 5 ? [0.96, 1] : 1,
          }}
          transition={{ duration: 0.25 }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={recording ? "rec" : saved ? "saved" : "idle"}
              className="flex items-center gap-1.5"
              initial={{ y: 14, opacity: 0, filter: "blur(2px)" }}
              animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
              exit={{ y: -14, opacity: 0, filter: "blur(2px)" }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            >
              {recording ? (
                <>
                  <span className="size-2 rounded-[2px] bg-white" />
                  Stop recording
                </>
              ) : saved ? (
                <>
                  <RiCheckLine className="size-3.5" />
                  Added to Project media
                </>
              ) : (
                "Start recording"
              )}
            </motion.span>
          </AnimatePresence>
        </motion.div>

        <div className="mt-3 flex gap-1.5">
          {SOURCES.map(({ label, icon: Icon }, i) => {
            const on = step >= i + 1;
            return (
              <motion.span
                key={label}
                className="flex flex-1 items-center justify-center gap-1 rounded-full border py-1 text-[9.5px]"
                animate={{
                  borderColor: on ? "oklch(0.6 0.17 150 / 0.45)" : "oklch(0.91 0.004 106)",
                  backgroundColor: on ? "oklch(0.95 0.045 150)" : "oklch(1 0 0)",
                  color: on ? "oklch(0.42 0.13 150)" : "oklch(0.55 0.006 106)",
                }}
                transition={{ duration: 0.2 }}
              >
                <Icon className="size-3" />
                {label}
              </motion.span>
            );
          })}
        </div>
      </Panel>

      <Cursor
        animate={
          step >= 4 && step <= 5
            ? { left: "52%", top: "50%", scale: step === 5 ? [1, 0.8, 1] : 1 }
            : { left: "82%", top: "84%", scale: 1 }
        }
      />
    </div>
  );
}

function StatusPill({ recording, saved }: { recording: boolean; saved: boolean }) {
  return (
    <span className="ml-auto flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-[9px] text-ink-soft">
      <motion.span
        className="size-1.5 rounded-full"
        animate={{
          backgroundColor: recording
            ? "oklch(0.62 0.21 27)"
            : saved
              ? "oklch(0.6 0.17 150)"
              : "oklch(0.8 0 0)",
          opacity: recording ? [1, 0.3, 1] : 1,
        }}
        transition={recording ? { opacity: { repeat: Infinity, duration: 1 } } : { duration: 0.2 }}
      />
      {recording ? <Timer /> : saved ? "00:04" : "Idle"}
    </span>
  );
}

function Timer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 620);
    return () => window.clearInterval(id);
  }, []);
  return <span className="tabular-nums">00:0{Math.min(seconds, 9)}</span>;
}
