import { motion } from "motion/react";
import type { ComponentType } from "react";
import { ExportDemo } from "./demos/export-demo";
import { RecordDemo } from "./demos/record-demo";
import { ReviewDemo } from "./demos/review-demo";
import { StreamDemo } from "./demos/stream-demo";
import { TimelineDemo } from "./demos/timeline-demo";
import { TranscriptDemo } from "./demos/transcript-demo";
import { Reveal, SectionHeading } from "./reveal";

const FEATURES: readonly {
  title: string;
  body: string;
  demo: ComponentType;
  status?: string;
}[] = [
  {
    title: "Record straight into the project",
    body: "Capture screen, camera and microphone, then edit the take without exporting or re-importing it.",
    demo: RecordDemo,
    status: "In development",
  },
  {
    title: "A real timeline",
    body: "Split, trim, roll, slip and ripple with linked picture and sound. Every edit can be undone.",
    demo: TimelineDemo,
  },
  {
    title: "Edit by transcript",
    body: "Transcribe locally, find filler words and long pauses, and remove them from the text.",
    demo: TranscriptDemo,
  },
  {
    title: "Feedback pinned to the frame",
    body: "Comments stay attached to the version and timestamp they were written on, with replies and resolution.",
    demo: ReviewDemo,
    status: "Planned",
  },
  {
    title: "Go live everywhere",
    body: "Record and stream at once, to several destinations, in landscape and portrait.",
    demo: StreamDemo,
    status: "Planned",
  },
  {
    title: "Deliver in the right format",
    body: "WebM in the browser, plus H.264 MP4 and 4K HEVC from the desktop app.",
    demo: ExportDemo,
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-24 py-24">
      <SectionHeading eyebrow="Why raE.E" title="Editing, recording and review that stay in sync">
        The same project carries a take from the recorder to the timeline, through review and out to
        delivery.
      </SectionHeading>

      <div className="mx-auto mt-14 grid max-w-6xl gap-4 px-6 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ title, body, demo: Demo, status }, i) => (
          <Reveal key={title} delay={(i % 3) * 0.07}>
            <motion.article
              className="group h-full rounded-[22px] border border-line bg-white p-2 shadow-[0_1px_2px_rgb(0_0_0/0.03)]"
              whileHover={{ y: -4, boxShadow: "0 22px 44px -26px rgb(20 50 30 / 0.35)" }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
            >
              <div className="stage-glow relative h-60 overflow-hidden rounded-[16px]">
                <div className="dot-grid absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
                <Demo />
              </div>
              <div className="px-3 pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h3>
                  {status && (
                    <span className="rounded-full bg-paper px-1.5 py-px text-[10px] font-medium text-ink-faint ring-1 ring-line">
                      {status}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">{body}</p>
              </div>
            </motion.article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
