import { RiArrowRightUpLine, RiGithubFill } from "@remixicon/react";
import { motion, useMotionValueEvent, useScroll } from "motion/react";
import { useState } from "react";
import { EDITOR_URL, REPO_URL } from "@/lib/links";
import { Logo } from "./logo";

const LINKS = [
  { href: "#workflow", label: "Workflow" },
  { href: "#features", label: "Features" },
  { href: "#agents", label: "Automation" },
  { href: "#roadmap", label: "Roadmap" },
] as const;

export function SiteNav() {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 12));

  return (
    <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3">
      <motion.nav
        className="flex w-full max-w-6xl items-center gap-6 rounded-2xl px-3 py-2 min-[1176px]:px-6"
        animate={{
          backgroundColor: scrolled ? "rgb(255 255 255 / 0.78)" : "rgb(255 255 255 / 0)",
          boxShadow: scrolled
            ? "0 0 0 1px rgb(0 0 0 / 0.06), 0 8px 24px -12px rgb(0 0 0 / 0.18)"
            : "0 0 0 1px rgb(0 0 0 / 0), 0 0 0 0 rgb(0 0 0 / 0)",
        }}
        transition={{ duration: 0.25 }}
        style={{ backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" }}
      >
        <a href="#top" aria-label="raE.E home" className="flex items-center">
          <Logo />
        </a>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="block rounded-lg px-2.5 py-1.5 text-[13px] leading-5 text-ink-soft transition-colors hover:bg-black/[0.04] hover:text-ink"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1.5">
          <a
            href={REPO_URL}
            className="grid size-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-black/[0.04] hover:text-ink"
            aria-label="raE.E on GitHub"
          >
            <RiGithubFill className="size-[18px]" />
          </a>
          <a
            href={EDITOR_URL}
            className="group inline-flex items-center gap-1 rounded-xl bg-ink px-3.5 py-2 text-[13px] font-medium text-white transition-transform active:scale-[0.97]"
          >
            Open the editor
            <RiArrowRightUpLine className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        </div>
      </motion.nav>
    </header>
  );
}
