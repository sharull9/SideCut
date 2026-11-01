import { RiCodeSSlashLine, RiPlugLine, RiServerLine, RiTerminalBoxLine } from "@remixicon/react";
import { motion, useInView } from "motion/react";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { useEffect, useRef, useState } from "react";
import { Reveal } from "./reveal";

const SCRIPT = [
  { cmd: "raee status", out: "Launch video · revision 42 · 14 clips · 02:31" },
  { cmd: "raee pauses", out: "11 pauses longer than 0.4 s · 18.2 s total" },
  { cmd: "raee tighten --apply", out: "✓ Removed 11 pauses · revision 43 · undo available" },
  { cmd: "raee export -o launch.mp4", out: "✓ Saved exports/launch.mp4 · H.264 1080p" },
] as const;

const SURFACES = [
  {
    icon: RiTerminalBoxLine,
    title: "CLI",
    body: "Readable output by default, --json for scripts.",
  },
  {
    icon: RiPlugLine,
    title: "MCP server",
    body: "Agents query and edit through the same commands.",
  },
  {
    icon: RiCodeSSlashLine,
    title: "TypeScript SDK",
    body: "A typed client for bulk and scripted edits.",
  },
  { icon: RiServerLine, title: "Headless host", body: "Run projects without opening a window." },
] as const;

export function Agents() {
  return (
    <section id="agents" className="scroll-mt-24 py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-[1fr_1.1fr]">
        <Reveal>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-1 font-mono text-[10.5px] tracking-wider text-ink-soft uppercase">
            <span className="size-1.5 rounded-full bg-brand" />
            Automation
          </span>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-[40px] sm:leading-[1.08]">
            Your agents can edit too
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
            Scripts and agents use the editor's own command history. Helpers preview first, apply
            only when asked and refuse to overwrite a newer revision.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {SURFACES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-line bg-white p-4">
                <Icon className="size-4 text-brand-deep" />
                <p className="mt-2 text-[13.5px] font-semibold">{title}</p>
                <p className="mt-1 text-[12.5px] leading-snug text-ink-soft">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <Terminal />
        </Reveal>
      </div>
    </section>
  );
}

function Terminal() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const reduce = useReducedMotion();
  const [line, setLine] = useState(0);
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    if (reduce) {
      setLine(SCRIPT.length);
      return;
    }
    if (!inView || line >= SCRIPT.length) return;
    const cmd = SCRIPT[line]!.cmd;
    if (typed < cmd.length) {
      const id = window.setTimeout(() => setTyped((t) => t + 1), 34 + Math.random() * 40);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => {
      setLine((l) => l + 1);
      setTyped(0);
    }, 650);
    return () => window.clearTimeout(id);
  }, [inView, reduce, line, typed]);

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-2xl bg-[oklch(0.17_0.006_150)] shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)] ring-1 ring-black/10"
    >
      <div className="flex items-center gap-1.5 border-b border-white/[0.07] px-4 py-3">
        {["bg-white/20", "bg-white/20", "bg-white/20"].map((tone, i) => (
          <span key={i} className={`size-2.5 rounded-full ${tone}`} />
        ))}
        <span className="ml-3 font-mono text-[11px] text-white/40">~/videos/launch</span>
      </div>
      <div className="min-h-[260px] space-y-3 p-5 font-mono text-[12.5px] leading-relaxed">
        {SCRIPT.map((entry, i) => {
          if (i > line) return null;
          const current = i === line;
          const shown = current ? entry.cmd.slice(0, typed) : entry.cmd;
          return (
            <div key={entry.cmd}>
              <p className="text-white/90">
                <span className="text-[oklch(0.75_0.16_150)]">$ </span>
                {shown}
                {current && (
                  <motion.span
                    className="ml-0.5 inline-block h-[1.05em] w-[7px] translate-y-[2px] bg-white/70"
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  />
                )}
              </p>
              {!current && (
                <motion.p
                  className={
                    entry.out.startsWith("✓") ? "text-[oklch(0.8_0.14_150)]" : "text-white/50"
                  }
                  initial={reduce ? false : { opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {entry.out}
                </motion.p>
              )}
            </div>
          );
        })}
        {line >= SCRIPT.length && (
          <p className="text-white/90">
            <span className="text-[oklch(0.75_0.16_150)]">$ </span>
            <motion.span
              className="inline-block h-[1.05em] w-[7px] translate-y-[2px] bg-white/70"
              animate={{ opacity: [1, 0, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
            />
          </p>
        )}
      </div>
    </div>
  );
}
