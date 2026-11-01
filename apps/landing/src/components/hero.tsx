import { RiArrowRightLine } from "@remixicon/react";
import { motion } from "motion/react";
import { EDITOR_URL } from "@/lib/links";
import { ExplodedStack } from "./exploded-stack";

const HEADLINE = ["From", "first", "take", "to", "final", "cut."] as const;
const EASE = [0.22, 1, 0.36, 1] as const;

export function Hero() {
  const enter = (delay: number) => ({
    initial: { opacity: 0, y: 14, filter: "blur(6px)" },
    animate: { opacity: 1, y: 0, filter: "blur(0px)" },
    transition: { duration: 0.8, delay, ease: EASE },
  });

  return (
    <section id="top" className="relative overflow-hidden pt-32 pb-16 sm:pt-36 lg:pb-24">
      <div className="dot-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(70%_60%_at_70%_40%,black,transparent)]" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <motion.p
            {...enter(0)}
            className="inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-ink-soft uppercase"
          >
            <span className="h-px w-6 bg-ink/40" />
            Local-first video editor
          </motion.p>

          <h1 className="mt-5 text-[44px] leading-[1.02] font-semibold tracking-[-0.045em] sm:text-[64px]">
            {HEADLINE.map((word, i) => (
              <motion.span
                key={word}
                className={`inline-block pr-[0.22em] ${i >= 4 ? "text-brand-deep" : ""}`}
                {...enter(0.08 + i * 0.06)}
              >
                {word}
              </motion.span>
            ))}
          </h1>

          <motion.p
            {...enter(0.5)}
            className="mt-6 max-w-md text-[16px] leading-relaxed text-pretty text-ink-soft"
          >
            Record your screen, cut on a real timeline, edit by transcript and collect
            frame-accurate feedback. raE.E runs in the browser or as a desktop app, and your media
            stays on your machine.
          </motion.p>

          <motion.div {...enter(0.62)} className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={EDITOR_URL}
              className="group inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-[14px] font-medium text-white shadow-[0_8px_24px_-10px_rgb(0_0_0/0.5)] transition-transform active:scale-[0.97]"
            >
              Open the editor
              <RiArrowRightLine className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a
              href="#workflow"
              className="inline-flex items-center rounded-xl border border-line-strong bg-white px-5 py-3 text-[14px] font-medium transition-colors hover:bg-paper active:scale-[0.97]"
            >
              See how it fits together
            </a>
          </motion.div>

          <motion.ul
            {...enter(0.74)}
            className="mt-10 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] text-ink-faint"
          >
            <li>Browser + Windows desktop</li>
            <li>No account to edit</li>
            <li>CLI · MCP · SDK</li>
          </motion.ul>
        </div>

        <div className="relative -mx-2 sm:mx-0">
          <ExplodedStack />
        </div>
      </div>
    </section>
  );
}
