import { RiAddLine } from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Reveal, SectionHeading } from "./reveal";

const PHASES = [
  {
    title: "Recording → editable project",
    range: "M0–M3",
    status: "In progress",
    items: [
      "Browser screen, camera and microphone capture into Project media",
      "Recording storage for long sessions and disk-full recovery",
      "Native Windows capture with hardware encoding and MP4 remux",
      "Recording library with posters, source offsets and one-step edit",
    ],
  },
  {
    title: "Review and cloud library",
    range: "M4–M6",
    status: "Planned",
    items: [
      "Immutable review versions with timestamped threads and replies",
      "Review player with shuttle, theater mode and CSV handoff",
      "Teams, folders, resumable uploads and hosted playback",
      "Share links with expiry, passwords and download control",
    ],
  },
  {
    title: "Live studio and streaming",
    range: "M7–M8",
    status: "Planned",
    items: [
      "Scenes, live backgrounds, banners and a live audio mixer",
      "Recent-clip saves at 30 or 60 seconds",
      "RTMP/RTMPS multistream with per-destination health",
      "Simultaneous landscape and portrait output",
    ],
  },
  {
    title: "AI, accounts and release hardening",
    range: "M9–M12",
    status: "Planned",
    items: [
      "Live captions and post-recording clean cuts",
      "Optional hosted AI with separate, revocable consent",
      "Phone remote, OBS scene import and hotkeys",
      "Signed releases across platforms with recorded acceptance",
    ],
  },
] as const;

export function Roadmap() {
  const [open, setOpen] = useState(0);

  return (
    <section id="roadmap" className="scroll-mt-24 py-24">
      <SectionHeading eyebrow="Roadmap" title="Built in the open, one phase at a time">
        The editor ships today. Recording comes next, then review, the live studio and hosted
        services. Each phase lands with its own acceptance checks.
      </SectionHeading>

      <Reveal className="mx-auto mt-12 max-w-3xl px-6">
        <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {PHASES.map((phase, i) => {
            const expanded = open === i;
            return (
              <li key={phase.title}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? -1 : i)}
                  className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-paper/70 focus-visible:bg-paper focus-visible:outline-none"
                >
                  <span className="font-mono text-[11px] text-ink-faint">0{i + 1}</span>
                  <span className="flex-1 text-[15px] font-medium">
                    {phase.title}
                    <span className="ml-2 font-mono text-[11px] font-normal text-ink-faint">
                      {phase.range}
                    </span>
                  </span>
                  <span
                    className={`hidden rounded-full px-2 py-0.5 text-[10.5px] font-medium sm:inline ${
                      i === 0
                        ? "bg-brand-soft text-brand-deep"
                        : "bg-paper text-ink-soft ring-1 ring-line"
                    }`}
                  >
                    {phase.status}
                  </span>
                  <motion.span
                    animate={{ rotate: expanded ? 45 : 0 }}
                    transition={{ type: "spring", stiffness: 400, damping: 28 }}
                    className="text-ink-soft"
                  >
                    <RiAddLine className="size-4" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 300, damping: 34 }}
                      className="overflow-hidden"
                    >
                      <ul className="grid gap-2 px-5 pb-5 pl-[52px] sm:grid-cols-2">
                        {phase.items.map((item, j) => (
                          <motion.li
                            key={item}
                            className="flex gap-2 text-[13.5px] leading-snug text-ink-soft"
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 + j * 0.04 }}
                          >
                            <span className="mt-[7px] size-1 shrink-0 rounded-full bg-ink/40" />
                            {item}
                          </motion.li>
                        ))}
                      </ul>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            );
          })}
        </ol>
      </Reveal>
    </section>
  );
}
