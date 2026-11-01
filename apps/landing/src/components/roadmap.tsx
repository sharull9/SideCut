import { motion } from "motion/react";
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
  return (
    <section id="roadmap" className="scroll-mt-24 py-24">
      <SectionHeading eyebrow="Roadmap" title="Built in the open, one phase at a time">
        The editor ships today. Recording comes next, then review, the live studio and hosted
        services. Each phase lands with its own acceptance checks.
      </SectionHeading>

      <ol className="mx-auto mt-14 grid max-w-6xl gap-4 px-6 md:grid-cols-2 lg:grid-cols-4">
        {PHASES.map((phase, i) => {
          const current = i === 0;
          const last = i === PHASES.length - 1;
          return (
            <li key={phase.title}>
              <Reveal
                delay={i * 0.07}
                className="relative h-full pl-8 md:max-lg:pl-0 lg:pt-10 lg:pl-0"
              >
                {/* Rail: vertical on small screens, horizontal across the row on lg. */}
                <span
                  aria-hidden
                  className={`absolute top-6 -bottom-4 left-[7px] w-px md:max-lg:hidden lg:top-[15px] lg:bottom-auto lg:left-4 lg:h-px lg:w-auto ${
                    current
                      ? "bg-gradient-to-b from-brand to-line lg:right-[-1rem] lg:bg-gradient-to-r"
                      : last
                        ? "hidden lg:right-0 lg:block lg:bg-gradient-to-r lg:from-line lg:to-transparent"
                        : "bg-line lg:right-[-1rem]"
                  }`}
                />
                <span
                  aria-hidden
                  className={`absolute top-5 left-0 grid size-[15px] place-items-center rounded-full md:max-lg:hidden lg:top-2 lg:left-2 ${
                    current ? "bg-brand-soft" : "bg-paper ring-1 ring-line-strong"
                  }`}
                >
                  {current ? (
                    <span className="relative flex size-[7px]">
                      <span className="absolute inset-0 animate-ping rounded-full bg-brand opacity-60 motion-reduce:animate-none" />
                      <span className="relative size-[7px] rounded-full bg-brand" />
                    </span>
                  ) : (
                    <span className="size-[5px] rounded-full bg-line-strong" />
                  )}
                </span>

                <motion.article
                  className={`flex h-full flex-col rounded-[20px] border bg-white p-5 ${
                    current
                      ? "border-brand/35 shadow-[0_18px_40px_-28px_rgb(20_80_40/0.45)]"
                      : "border-line shadow-[0_1px_2px_rgb(0_0_0/0.03)]"
                  }`}
                  whileHover={{ y: -3 }}
                  transition={{ type: "spring", stiffness: 300, damping: 26 }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[11px] tracking-wider text-ink-faint uppercase">
                      Phase 0{i + 1}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
                        current
                          ? "bg-brand-soft text-brand-deep"
                          : "bg-paper text-ink-soft ring-1 ring-line"
                      }`}
                    >
                      {phase.status}
                    </span>
                  </div>

                  <h3 className="mt-4 text-[17px] leading-snug font-semibold tracking-[-0.015em] text-balance">
                    {phase.title}
                  </h3>
                  <p className="mt-1 font-mono text-[11px] text-ink-faint">
                    Milestones {phase.range}
                  </p>

                  <ul className="mt-4 flex flex-col gap-2.5 border-t border-line pt-4">
                    {phase.items.map((item) => (
                      <li
                        key={item}
                        className="flex gap-2.5 text-[13.5px] leading-snug text-pretty text-ink-soft"
                      >
                        <span
                          className={`mt-[6px] size-1.5 shrink-0 rounded-full ${
                            current ? "bg-brand" : "bg-ink/25"
                          }`}
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </motion.article>
              </Reveal>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
