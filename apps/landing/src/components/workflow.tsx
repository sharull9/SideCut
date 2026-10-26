import { RiArrowRightLine } from "@remixicon/react";
import { motion, useInView } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { useEffect, useRef, useState } from "react";
import { Reveal, SectionHeading } from "./reveal";

type Pillar = "editor" | "studio" | "cloud";

const STAGES: readonly { label: string; pillars: readonly Pillar[] }[] = [
  { label: "Capture / Go live", pillars: ["studio"] },
  { label: "Edit", pillars: ["editor"] },
  { label: "Review", pillars: ["cloud"] },
  { label: "Revise", pillars: ["editor"] },
  { label: "Deliver", pillars: ["editor", "cloud"] },
];

const PILLARS: readonly {
  id: Pillar;
  tag: string;
  title: string;
  body: string;
  status: string;
  ready: boolean;
}[] = [
  {
    id: "editor",
    tag: "Existing foundation",
    title: "Shared editor",
    body: "Browser and Electron UI, edit commands, timeline, transcripts, captions and effects.",
    status: "Available",
    ready: true,
  },
  {
    id: "studio",
    tag: "New native engine",
    title: "Production studio",
    body: "Capture, live scenes, sustained recording, hardware encoding and multistream.",
    status: "In development",
    ready: false,
  },
  {
    id: "cloud",
    tag: "New optional service",
    title: "Cloud review + AI",
    body: "Teams, uploads, versions, guest feedback, hosted playback and service jobs.",
    status: "Planned",
    ready: false,
  },
];

const CYCLE_MS = 2200;

export function Workflow() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-20% 0px" });
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!inView || pinned || reduce) return;
    const id = window.setTimeout(() => setActive((i) => (i + 1) % STAGES.length), CYCLE_MS);
    return () => window.clearTimeout(id);
  }, [active, inView, pinned, reduce]);

  const lit = STAGES[active]!.pillars;

  return (
    <section id="workflow" className="scroll-mt-24 py-24">
      <SectionHeading eyebrow="One workflow" title="Every stage of a video, in one project">
        Capture or go live, edit, gather feedback, revise and deliver. Recordings land in the same
        project you edit, so nothing is exported just to be imported again.
      </SectionHeading>

      <div ref={ref} className="mx-auto mt-14 max-w-5xl px-6">
        <Reveal>
          <div
            className="flex flex-wrap items-center justify-center gap-2"
            onMouseLeave={() => setPinned(false)}
          >
            {STAGES.map((stage, i) => (
              <button
                key={stage.label}
                type="button"
                onMouseEnter={() => {
                  setPinned(true);
                  setActive(i);
                }}
                onFocus={() => {
                  setPinned(true);
                  setActive(i);
                }}
                onBlur={() => setPinned(false)}
                className="relative flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <span className="absolute inset-0 rounded-xl border border-line bg-white" />
                {active === i && (
                  <motion.span
                    layoutId="stage-pill"
                    className="absolute inset-0 rounded-xl bg-ink"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span
                  className={`relative flex items-center gap-1.5 transition-colors duration-200 ${
                    active === i ? "text-white" : "text-ink-soft"
                  }`}
                >
                  {i > 0 && <RiArrowRightLine className="size-3.5 opacity-60" />}
                  {stage.label}
                </span>
              </button>
            ))}
          </div>
        </Reveal>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {PILLARS.map((pillar, i) => {
            const on = lit.includes(pillar.id);
            return (
              <Reveal key={pillar.id} delay={0.08 * i}>
                <motion.article
                  className="relative h-full overflow-hidden rounded-2xl border bg-white p-6"
                  animate={{
                    borderColor: on ? "oklch(0.6 0.17 150 / 0.55)" : "oklch(0.91 0.004 106)",
                    y: on ? -4 : 0,
                    boxShadow: on
                      ? "0 18px 40px -22px oklch(0.45 0.12 150 / 0.55)"
                      : "0 1px 2px rgb(0 0 0 / 0.03)",
                  }}
                  transition={{ type: "spring", stiffness: 260, damping: 26 }}
                >
                  <div className="flex items-center justify-between">
                    <p className="font-mono text-[10.5px] tracking-[0.12em] text-ink-faint uppercase">
                      {pillar.tag}
                    </p>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        pillar.ready
                          ? "bg-brand-soft text-brand-deep"
                          : "bg-paper text-ink-soft ring-1 ring-line"
                      }`}
                    >
                      {pillar.status}
                    </span>
                  </div>
                  <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em]">
                    {pillar.title}
                  </h3>
                  <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{pillar.body}</p>
                  <motion.span
                    className="absolute inset-x-0 bottom-0 h-[3px] origin-left bg-brand"
                    initial={false}
                    animate={{ scaleX: on ? 1 : 0 }}
                    transition={{ duration: on && !pinned ? CYCLE_MS / 1000 : 0.3, ease: "linear" }}
                  />
                </motion.article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
