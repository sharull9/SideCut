import { motion, type TargetAndTransition } from "motion/react";
import type { ReactNode } from "react";

export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-2xl border border-white bg-white/95 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(20_40_25/0.22)] ring-1 ring-black/[0.04] ${className}`}
    >
      {children}
    </div>
  );
}

export function Cursor({ animate }: { animate: TargetAndTransition }) {
  return (
    <motion.svg
      aria-hidden
      viewBox="0 0 16 20"
      className="pointer-events-none absolute z-10 h-5 w-4 drop-shadow-[0_2px_3px_rgb(0_0_0/0.25)]"
      initial={false}
      animate={animate}
      transition={{
        type: "spring",
        stiffness: 120,
        damping: 20,
        scale: { type: "tween", duration: 0.3, ease: "easeOut" },
      }}
    >
      <path
        d="M1 1 L1 15.5 L4.8 12 L7.4 18 L9.9 17 L7.4 11.2 L12.6 11.2 Z"
        fill="#111"
        stroke="#fff"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </motion.svg>
  );
}

export function Chip({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-line bg-white px-2 py-0.5 text-[9.5px] font-medium text-ink-soft ${className}`}
    >
      {children}
    </span>
  );
}
