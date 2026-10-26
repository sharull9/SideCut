import { RiCheckLine, RiPlayFill } from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import { useDemoLoop } from "@/lib/use-demo-loop";
import { Chip, Panel } from "./parts";

const STEPS = [1900, 1900, 2200] as const;

const COMMENTS = [
  { at: 28, time: "00:42", who: "M", tone: "bg-amber-200", text: "Tighten this pause a little." },
  { at: 61, time: "01:31", who: "J", tone: "bg-sky-200", text: "Logo needs more breathing room." },
] as const;

export function ReviewDemo() {
  const { ref, step } = useDemoLoop(STEPS);
  const resolved = step === 2;
  const comment = COMMENTS[Math.min(step, 1)]!;

  return (
    <div ref={ref} className="relative flex h-full flex-col items-center justify-center gap-2.5">
      <Panel className="w-[82%] max-w-[300px] p-2.5">
        <div className="relative grid aspect-[16/7] place-items-center overflow-hidden rounded-lg bg-[linear-gradient(135deg,oklch(0.3_0.02_150),oklch(0.2_0.01_150))]">
          <span className="grid size-7 place-items-center rounded-full bg-white/15 text-white backdrop-blur">
            <RiPlayFill className="size-3.5" />
          </span>
          <span className="absolute top-1.5 left-1.5 rounded bg-black/40 px-1.5 py-0.5 font-mono text-[8.5px] text-white/80">
            {resolved ? "v3" : "v2"}
          </span>
        </div>
        <div className="relative mx-1 mt-3 mb-1 h-1 rounded-full bg-line">
          <motion.div
            className="absolute inset-y-0 left-0 rounded-full bg-ink/70"
            initial={false}
            animate={{ width: `${comment.at}%` }}
            transition={{ type: "spring", stiffness: 90, damping: 20 }}
          />
          {COMMENTS.map((c, i) => (
            <AnimatePresence key={c.time}>
              {step >= i && (
                <motion.span
                  className={`absolute -top-[7px] grid size-[18px] -translate-x-1/2 place-items-center rounded-full border-2 border-white text-[8px] font-semibold shadow ${
                    resolved && i === 0 ? "bg-brand text-white" : c.tone
                  }`}
                  style={{ left: `${c.at}%` }}
                  initial={{ scale: 0, y: -8 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: "spring", stiffness: 500, damping: 22 }}
                >
                  {resolved && i === 0 ? <RiCheckLine className="size-2.5" /> : c.who}
                </motion.span>
              )}
            </AnimatePresence>
          ))}
        </div>
      </Panel>

      <div className="relative h-[54px] w-[82%] max-w-[300px]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={resolved ? "resolved" : comment.time}
            className="absolute inset-0"
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
          >
            <Panel className="flex h-full items-center gap-2.5 px-3">
              <span
                className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                  resolved ? "bg-brand text-white" : comment.tone
                }`}
              >
                {resolved ? <RiCheckLine className="size-3.5" /> : comment.who}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[11px] font-medium">
                  {resolved ? "Pause tightened in v3" : comment.text}
                </p>
                <p className="mt-0.5 font-mono text-[9px] text-ink-faint">
                  {resolved ? "Reply · 00:42" : `${comment.time} · frame-accurate`}
                </p>
              </div>
              <Chip className={resolved ? "border-brand/40 bg-brand-soft text-brand-deep" : ""}>
                {resolved ? "Resolved" : "Open"}
              </Chip>
            </Panel>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
