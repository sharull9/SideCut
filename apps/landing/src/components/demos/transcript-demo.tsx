import { AnimatePresence, motion } from "motion/react";
import { useDemoLoop } from "@/lib/use-demo-loop";
import { Chip, Panel } from "./parts";

// read, find fillers, remove them, show the tightened result
const STEPS = [1400, 1500, 900, 2200] as const;

const WORDS = [
  "So",
  "um,",
  "today",
  "I'll",
  "show",
  "you",
  "know,",
  "how",
  "a",
  "ripple",
  "cut",
  "uh,",
  "closes",
  "the",
  "gap.",
] as const;
const FILLERS = new Set([1, 5, 6, 11]);
const WAVE = Array.from({ length: 38 }, (_, i) =>
  Math.max(3, Math.round(12 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45)))),
);
const WAVE_FILLER = new Set([4, 5, 6, 15, 16, 17, 18, 29, 30]);

export function TranscriptDemo() {
  const { ref, step } = useDemoLoop(STEPS);
  const flagged = step >= 1;
  const removed = step >= 2;

  return (
    <div ref={ref} className="relative flex h-full items-center justify-center">
      <Panel className="w-[84%] max-w-[310px] p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[9px] tracking-wider text-ink-faint">TRANSCRIPT</span>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={step}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <Chip className={step === 3 ? "border-brand/40 text-brand-deep" : ""}>
                {step === 0 ? "Speaker 1" : step === 3 ? "Saved 1.8 s" : "4 filler words"}
              </Chip>
            </motion.span>
          </AnimatePresence>
        </div>

        <motion.p layout className="flex flex-wrap gap-x-[3px] gap-y-0.5 text-[12px] leading-5">
          <AnimatePresence mode="popLayout" initial={false}>
            {WORDS.map((word, i) => {
              const filler = FILLERS.has(i);
              if (filler && removed) return null;
              return (
                <motion.span
                  layout
                  key={`${word}${i}`}
                  className="rounded px-[1px]"
                  initial={{ opacity: 0 }}
                  animate={{
                    opacity: 1,
                    backgroundColor:
                      filler && flagged ? "oklch(0.62 0.21 27 / 0.14)" : "oklch(1 0 0 / 0)",
                    color: filler && flagged ? "oklch(0.5 0.19 27)" : "oklch(0.18 0.004 106)",
                    textDecorationColor:
                      filler && flagged ? "oklch(0.5 0.19 27)" : "oklch(0.5 0.19 27 / 0)",
                  }}
                  exit={{ opacity: 0, scale: 0.6, filter: "blur(3px)" }}
                  transition={{ type: "spring", stiffness: 300, damping: 28 }}
                  style={{ textDecorationLine: "line-through", textDecorationThickness: 1.5 }}
                >
                  {word}
                </motion.span>
              );
            })}
          </AnimatePresence>
        </motion.p>

        <div className="mt-3 flex h-6 items-center justify-center gap-[3px]">
          {WAVE.map((height, i) => {
            const filler = WAVE_FILLER.has(i);
            return (
              <motion.span
                key={i}
                className="block h-full origin-center rounded-full"
                animate={{
                  width: filler && removed ? 0 : 4,
                  marginLeft: filler && removed ? -3 : 0,
                  scaleY: height / 12,
                  backgroundColor:
                    filler && flagged ? "oklch(0.62 0.21 27 / 0.7)" : "oklch(0.6 0.17 150 / 0.75)",
                }}
                transition={{ type: "spring", stiffness: 220, damping: 26 }}
              />
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
