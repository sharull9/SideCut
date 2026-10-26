import { RiCheckLine, RiFileVideoLine } from "@remixicon/react";
import { motion } from "motion/react";
import { useDemoLoop } from "@/lib/use-demo-loop";
import { Panel } from "./parts";

// queued, then each preset renders in turn
const STEPS = [700, 1300, 1300, 1300, 2200] as const;

const PRESETS = [
  { name: "MP4 · H.264", detail: "1080p · AAC" },
  { name: "HEVC", detail: "3840 × 2160" },
  { name: "WebM · VP8", detail: "Opus · in browser" },
] as const;

export function ExportDemo() {
  const { ref, step } = useDemoLoop(STEPS);

  return (
    <div ref={ref} className="relative flex h-full items-center justify-center">
      <Panel className="w-[82%] max-w-[300px] divide-y divide-line px-3 py-1">
        {PRESETS.map((preset, i) => {
          const state = step > i + 1 ? "done" : step === i + 1 ? "rendering" : "queued";
          return (
            <div key={preset.name} className="flex items-center gap-2.5 py-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-paper text-ink-soft ring-1 ring-line">
                <RiFileVideoLine className="size-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[11px] font-medium">{preset.name}</p>
                  <p className="shrink-0 font-mono text-[8.5px] text-ink-faint">{preset.detail}</p>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
                  <motion.div
                    className="h-full rounded-full bg-brand"
                    initial={false}
                    animate={{ width: state === "queued" ? "0%" : "100%" }}
                    transition={
                      state === "rendering"
                        ? { duration: 1.15, ease: [0.4, 0, 0.2, 1] }
                        : { duration: 0 }
                    }
                  />
                </div>
              </div>
              <motion.span
                className="grid size-4 shrink-0 place-items-center rounded-full"
                animate={{
                  backgroundColor:
                    state === "done" ? "oklch(0.6 0.17 150)" : "oklch(0.91 0.004 106)",
                  scale: state === "done" ? [0.6, 1.15, 1] : 1,
                }}
                transition={{ duration: 0.35 }}
              >
                {state === "done" && <RiCheckLine className="size-2.5 text-white" />}
              </motion.span>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}
