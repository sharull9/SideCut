import { RiCheckLine, RiPauseFill, RiPlayFill } from "@remixicon/react";
import {
  AnimatePresence,
  animate,
  motion,
  useInView,
  useMotionValue,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { Reveal, SectionHeading } from "./reveal";

type Pillar = "studio" | "editor" | "cloud";

const STAGES: readonly {
  label: string;
  summary: string;
  detail: string;
  pillars: readonly Pillar[];
}[] = [
  {
    label: "Capture / Go live",
    summary: "Record or stream",
    detail:
      "Record screen, camera and microphone, or go live. Each take lands in Project media, ready to cut.",
    pillars: ["studio"],
  },
  {
    label: "Edit",
    summary: "Timeline and transcript",
    detail:
      "Cut on the timeline or edit the transcript. Every change is a command you can undo or script.",
    pillars: ["editor"],
  },
  {
    label: "Review",
    summary: "Feedback on the frame",
    detail:
      "Share a version and collect comments pinned to the exact frame and version they were written on.",
    pillars: ["cloud"],
  },
  {
    label: "Revise",
    summary: "Fix in the same project",
    detail:
      "Turn feedback into timeline markers and fix them in the project you recorded, without re-importing.",
    pillars: ["editor"],
  },
  {
    label: "Deliver",
    summary: "Export or publish",
    detail:
      "Export MP4, 4K HEVC or WebM, or publish the new version so reviewers see what changed.",
    pillars: ["editor", "cloud"],
  },
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
    id: "studio",
    tag: "New native engine",
    title: "Production studio",
    body: "Capture, live scenes, sustained recording, hardware encoding and multistream.",
    status: "In development",
    ready: false,
  },
  {
    id: "editor",
    tag: "Existing foundation",
    title: "Shared editor",
    body: "Browser and Electron UI, edit commands, timeline, transcripts, captions and effects.",
    status: "Available",
    ready: true,
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

const STAGE_MS = 3600;

export function Workflow() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-20% 0px" });
  const reduce = useReducedMotion();
  const progress = useMotionValue(0);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovering, setHovering] = useState(false);
  const running = playing && !hovering && inView && !reduce;

  // Progress through the current stage resumes where it paused.
  useEffect(() => {
    if (!running) return;
    const controls = animate(progress, 1, {
      duration: ((1 - progress.get()) * STAGE_MS) / 1000,
      ease: "linear",
      onComplete: () => {
        progress.set(0);
        setActive((i) => (i + 1) % STAGES.length);
      },
    });
    return () => controls.stop();
  }, [running, active, progress]);

  const select = (index: number) => {
    progress.set(0);
    setActive(index);
  };

  const stage = STAGES[active]!;

  return (
    <section id="workflow" className="scroll-mt-24 py-24">
      <SectionHeading eyebrow="One workflow" title="Every stage of a video, in one project">
        Capture or go live, edit, gather feedback, revise and deliver. Recordings land in the same
        project you edit, so nothing is exported just to be imported again.
      </SectionHeading>

      <Reveal className="mx-auto mt-14 max-w-5xl px-6">
        <div
          ref={ref}
          className="grid gap-2 rounded-[28px] border border-line bg-white p-2 shadow-[0_1px_2px_rgb(0_0_0/0.03),0_24px_60px_-40px_rgb(20_50_30/0.35)] lg:grid-cols-[340px_1fr]"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          {/* Stage list: the ring and rail show progress through each stage. */}
          <div className="flex flex-col p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between px-2">
              <span className="font-mono text-[10.5px] tracking-[0.14em] text-ink-faint uppercase">
                Stage {String(active + 1).padStart(2, "0")} /{" "}
                {String(STAGES.length).padStart(2, "0")}
              </span>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                aria-label={playing ? "Pause the walkthrough" : "Play the walkthrough"}
                className="flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-[10.5px] tracking-wider text-ink-soft uppercase transition-colors hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
              >
                {playing && !reduce ? (
                  <RiPauseFill className="size-3.5" />
                ) : (
                  <RiPlayFill className="size-3.5" />
                )}
                {playing && !reduce ? "Pause" : "Play"}
              </button>
            </div>

            <ol className="flex flex-1 flex-col">
              {STAGES.map((item, i) => {
                const state = i < active ? "done" : i === active ? "active" : "next";
                const last = i === STAGES.length - 1;
                return (
                  <li key={item.label} className="relative lg:flex-1">
                    {!last && (
                      <span className="absolute top-[46px] bottom-[-14px] left-[27px] w-0.5 overflow-hidden rounded-full bg-line">
                        <motion.span
                          className="absolute inset-0 origin-top rounded-full bg-brand"
                          style={{
                            scaleY: state === "done" ? 1 : state === "active" ? progress : 0,
                          }}
                        />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => select(i)}
                      aria-current={state === "active" ? "step" : undefined}
                      className="flex w-full items-center gap-3.5 rounded-2xl px-2 py-2.5 text-left transition-colors hover:bg-paper focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none"
                    >
                      <StageNode state={state} index={i} progress={progress} />
                      <span className="min-w-0 leading-tight">
                        <span
                          className={`block text-[14.5px] font-medium transition-colors ${
                            state === "next" ? "text-ink-soft" : "text-ink"
                          }`}
                        >
                          {item.label}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] text-ink-faint">
                          {item.summary}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Detail: what happens at this stage and which product handles it. */}
          <div className="stage-glow relative overflow-hidden rounded-[22px] p-6 sm:p-8">
            <div className="dot-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />
            <div className="relative">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active}
                  initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="min-h-[112px]"
                >
                  <h3 className="text-[26px] font-semibold tracking-[-0.03em]">{stage.label}</h3>
                  <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-pretty text-ink-soft">
                    {stage.detail}
                  </p>
                </motion.div>
              </AnimatePresence>

              <p className="mt-6 mb-3 font-mono text-[10.5px] tracking-[0.14em] text-ink-faint uppercase">
                Handled by
              </p>
              <div className="space-y-2">
                {PILLARS.map((pillar) => (
                  <PillarRow
                    key={pillar.id}
                    pillar={pillar}
                    lit={stage.pillars.includes(pillar.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function StageNode({
  state,
  index,
  progress,
}: {
  state: "done" | "active" | "next";
  index: number;
  progress: MotionValue<number>;
}) {
  return (
    <span className="relative grid size-10 shrink-0 place-items-center">
      {state === "active" && (
        <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden>
          <circle cx={20} cy={20} r={15} fill="none" stroke="var(--color-line)" strokeWidth={2} />
          <motion.circle
            cx={20}
            cy={20}
            r={15}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth={2}
            strokeLinecap="round"
            style={{ pathLength: progress }}
          />
        </svg>
      )}
      <motion.span
        className="relative grid size-6 place-items-center rounded-full font-mono text-[10.5px]"
        initial={false}
        animate={{
          backgroundColor:
            state === "done"
              ? "oklch(0.6 0.17 150)"
              : state === "active"
                ? "oklch(0.18 0.004 106)"
                : "oklch(1 0 0)",
          color: state === "next" ? "oklch(0.55 0.006 106)" : "oklch(1 0 0)",
          boxShadow:
            state === "next"
              ? "inset 0 0 0 1px oklch(0.84 0.005 106)"
              : "inset 0 0 0 1px oklch(0 0 0 / 0)",
          scale: state === "active" ? 1.06 : 1,
        }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
      >
        {state === "done" ? <RiCheckLine className="size-3.5" /> : index + 1}
      </motion.span>
    </span>
  );
}

function PillarRow({ pillar, lit }: { pillar: (typeof PILLARS)[number]; lit: boolean }) {
  return (
    <motion.div
      layout
      className="overflow-hidden rounded-2xl border bg-white"
      initial={false}
      animate={{
        borderColor: lit ? "oklch(0.6 0.17 150 / 0.5)" : "oklch(0.91 0.004 106)",
        opacity: lit ? 1 : 0.62,
        boxShadow: lit
          ? "0 14px 32px -20px oklch(0.45 0.12 150 / 0.55)"
          : "0 1px 2px rgb(0 0 0 / 0.02)",
      }}
      transition={{ type: "spring", stiffness: 320, damping: 32 }}
    >
      <motion.div layout="position" className="flex items-center gap-3 px-4 py-3">
        <motion.span
          className="size-2 shrink-0 rounded-full"
          animate={{
            backgroundColor: lit ? "oklch(0.6 0.17 150)" : "oklch(0.84 0.005 106)",
            scale: lit ? [1, 1.35, 1] : 1,
          }}
          transition={{ duration: 0.4 }}
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold">{pillar.title}</span>
            <span className="block font-mono text-[10px] tracking-[0.12em] text-ink-faint uppercase">
              {pillar.tag}
            </span>
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
              pillar.ready
                ? "bg-brand-soft text-brand-deep"
                : "bg-paper text-ink-soft ring-1 ring-line"
            }`}
          >
            {pillar.status}
          </span>
        </span>
      </motion.div>
      <AnimatePresence initial={false}>
        {lit && (
          <motion.p
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="px-4 pl-9 text-[13px] leading-relaxed text-ink-soft"
          >
            <span className="block pb-3.5">{pillar.body}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
