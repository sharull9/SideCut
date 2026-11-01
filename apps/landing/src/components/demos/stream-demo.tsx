import {
  RiBroadcastFill,
  RiLink,
  RiTwitchFill,
  RiTwitterXFill,
  RiYoutubeFill,
} from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import { useDemoLoop } from "@/lib/use-demo-loop";

// rings, then each destination connects; RTMP retries before going healthy
const STEPS = [700, 550, 550, 550, 1300, 2400] as const;

const TARGETS = [
  { label: "YouTube", icon: RiYoutubeFill, color: "text-red-600", x: -96, y: -40 },
  { label: "Twitch", icon: RiTwitchFill, color: "text-violet-600", x: 92, y: -52 },
  { label: "X", icon: RiTwitterXFill, color: "text-ink", x: -84, y: 54 },
  { label: "RTMP", icon: RiLink, color: "text-ink-soft", x: 96, y: 46 },
] as const;

export function StreamDemo() {
  const { ref, step, reduce } = useDemoLoop(STEPS);

  return (
    <div ref={ref} className="relative flex h-full items-center justify-center">
      {[0, 1, 2].map((ring) => (
        <motion.span
          key={ring}
          className="absolute size-24 rounded-full border border-brand/30"
          animate={
            reduce
              ? { scale: 1 + ring * 0.6, opacity: 0.5 }
              : { scale: [1, 2.6], opacity: [0.6, 0] }
          }
          transition={reduce ? {} : { duration: 3, repeat: Infinity, delay: ring, ease: "easeOut" }}
        />
      ))}
      <span className="absolute size-40 rounded-full bg-white/60 ring-1 ring-brand/10" />

      <motion.div
        className="relative z-10 grid size-16 place-items-center rounded-full bg-[radial-gradient(circle_at_30%_25%,oklch(0.72_0.17_150),oklch(0.52_0.15_150))] text-white shadow-[0_10px_30px_-6px_oklch(0.5_0.15_150/0.65)]"
        animate={reduce ? {} : { scale: [1, 1.04, 1] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <RiBroadcastFill className="size-6" />
        <span className="absolute -bottom-2 rounded-full bg-rec px-1.5 py-px font-mono text-[8px] font-semibold tracking-wider text-white">
          LIVE
        </span>
      </motion.div>

      {TARGETS.map(({ label, icon: Icon, color, x, y }, i) => {
        const retrying = label === "RTMP" && step === 4;
        return (
          <AnimatePresence key={label}>
            {step >= i + 1 && (
              <motion.div
                className="absolute z-20 flex items-center gap-1.5 rounded-full border border-white bg-white px-2 py-1 shadow-[0_6px_18px_-6px_rgb(0_0_0/0.25)] ring-1 ring-black/[0.04]"
                initial={{ x: 0, y: 0, scale: 0.4, opacity: 0 }}
                animate={{ x, y, scale: 1, opacity: 1 }}
                exit={{ x: 0, y: 0, scale: 0.4, opacity: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
              >
                <Icon className={`size-3.5 ${color}`} />
                <span className="text-[10px] font-medium">{label}</span>
                <motion.span
                  className="size-1.5 rounded-full"
                  animate={{
                    backgroundColor: retrying ? "oklch(0.78 0.16 75)" : "oklch(0.65 0.18 150)",
                    opacity: retrying ? [1, 0.25, 1] : 1,
                  }}
                  transition={retrying ? { opacity: { repeat: Infinity, duration: 0.6 } } : {}}
                />
              </motion.div>
            )}
          </AnimatePresence>
        );
      })}

      <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-1.5">
        {["16:9 · 1080p60", "9:16 · 1080p30"].map((label, i) => (
          <motion.span
            key={label}
            className="rounded-md border border-line bg-white/90 px-1.5 py-0.5 font-mono text-[8.5px] whitespace-nowrap text-ink-soft"
            animate={{ opacity: step === 5 ? 1 : 0.35, y: step === 5 ? 0 : 3 }}
            transition={{ delay: step === 5 ? i * 0.1 : 0 }}
          >
            {label}
          </motion.span>
        ))}
      </div>
    </div>
  );
}
