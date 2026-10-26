import { AnimatePresence, motion } from "motion/react";
import { useDemoLoop } from "@/lib/use-demo-loop";
import { Chip, Panel } from "./parts";

// play to the cut, blade, lift the middle, ripple the rest closed
const STEPS = [1500, 900, 900, 2200] as const;

type Clip = { id: string; from: number; to: number; tone: "video" | "title" | "audio" | "cut" };

const BEFORE: Record<string, Clip[]> = {
  V2: [{ id: "title", from: 6, to: 26, tone: "title" }],
  V1: [
    { id: "a", from: 4, to: 64, tone: "video" },
    { id: "b", from: 66, to: 94, tone: "video" },
  ],
  A1: [
    { id: "wa", from: 4, to: 64, tone: "audio" },
    { id: "wb", from: 66, to: 94, tone: "audio" },
  ],
};

const SPLIT: Record<string, Clip[]> = {
  V2: BEFORE.V2!,
  V1: [
    { id: "a", from: 4, to: 34, tone: "video" },
    { id: "gap", from: 34, to: 50, tone: "cut" },
    { id: "a2", from: 50, to: 64, tone: "video" },
    { id: "b", from: 66, to: 94, tone: "video" },
  ],
  A1: [
    { id: "wa", from: 4, to: 34, tone: "audio" },
    { id: "wgap", from: 34, to: 50, tone: "cut" },
    { id: "wa2", from: 50, to: 64, tone: "audio" },
    { id: "wb", from: 66, to: 94, tone: "audio" },
  ],
};

const LIFTED: Record<string, Clip[]> = {
  V2: BEFORE.V2!,
  V1: SPLIT.V1!.filter((clip) => clip.tone !== "cut"),
  A1: SPLIT.A1!.filter((clip) => clip.tone !== "cut"),
};

const RIPPLED: Record<string, Clip[]> = {
  V2: BEFORE.V2!,
  V1: [
    { id: "a", from: 4, to: 34, tone: "video" },
    { id: "a2", from: 34, to: 48, tone: "video" },
    { id: "b", from: 50, to: 78, tone: "video" },
  ],
  A1: [
    { id: "wa", from: 4, to: 34, tone: "audio" },
    { id: "wa2", from: 34, to: 48, tone: "audio" },
    { id: "wb", from: 50, to: 78, tone: "audio" },
  ],
};

const STATES = [BEFORE, SPLIT, LIFTED, RIPPLED] as const;
const PLAYHEAD = [34, 34, 34, 70] as const;

const TONES = {
  video: "bg-white border-ink/25",
  title: "bg-brand-soft border-brand/40",
  audio:
    "border-ink/15 bg-[repeating-linear-gradient(90deg,oklch(0.6_0.17_150/0.35)_0_1.5px,transparent_1.5px_4px)] bg-white",
  cut: "bg-rec/15 border-rec/60",
} as const;

export function TimelineDemo() {
  const { ref, step } = useDemoLoop(STEPS);
  const tracks = STATES[step]!;

  return (
    <div ref={ref} className="relative flex h-full items-center justify-center">
      <Panel className="w-[86%] max-w-[330px] p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[9px] tracking-wider text-ink-faint">TIMELINE</span>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={step === 3 ? "done" : step >= 1 ? "cut" : "play"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
            >
              <Chip>
                {step === 3
                  ? "Ripple delete · 1.6 s"
                  : step >= 1
                    ? "Split at playhead"
                    : "00:12:04"}
              </Chip>
            </motion.span>
          </AnimatePresence>
        </div>

        <div className="relative space-y-1.5">
          {Object.entries(tracks).map(([name, clips]) => (
            <div key={name} className="flex items-center gap-2">
              <span className="w-4 font-mono text-[8.5px] text-ink-faint">{name}</span>
              <div className="relative h-5 flex-1 rounded-md bg-paper">
                <AnimatePresence initial={false}>
                  {clips.map((clip) => (
                    <motion.div
                      key={clip.id}
                      className={`absolute top-0 h-full rounded-[5px] border ${TONES[clip.tone]}`}
                      initial={{
                        opacity: 0,
                        left: `${clip.from}%`,
                        width: `${clip.to - clip.from}%`,
                      }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        left: `${clip.from}%`,
                        width: `${clip.to - clip.from - 0.8}%`,
                      }}
                      exit={{ opacity: 0, y: -10, scale: 0.9 }}
                      transition={{ type: "spring", stiffness: 210, damping: 26 }}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}

          <div className="pointer-events-none absolute inset-y-0 right-0 left-6">
            <motion.div
              className="absolute -top-1 bottom-[-4px] w-px bg-brand-deep"
              initial={false}
              animate={{ left: step === 0 ? ["8%", `${PLAYHEAD[0]}%`] : `${PLAYHEAD[step]}%` }}
              transition={{ duration: step === 0 ? 1.3 : 1.6, ease: "easeInOut" }}
            >
              <span className="absolute -top-1 -left-[4px] size-[9px] rotate-45 rounded-[2px] bg-brand-deep" />
            </motion.div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
