import { RiArrowRightLine } from "@remixicon/react";
import { EDITOR_URL, REPO_URL } from "@/lib/links";
import { Logo } from "./logo";
import { Reveal } from "./reveal";

export function Footer() {
  return (
    <footer className="px-6 pt-12 pb-10">
      <Reveal className="stage-glow relative mx-auto max-w-6xl overflow-hidden rounded-[28px] border border-line px-6 py-16 text-center">
        <div className="dot-grid absolute inset-0 [mask-image:radial-gradient(60%_70%_at_50%_100%,black,transparent)]" />
        <div className="relative">
          <h2 className="text-3xl font-semibold tracking-[-0.035em] text-balance sm:text-[44px]">
            Start your next cut
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] text-ink-soft">
            Open raE.E in your browser. Local editing works without an account.
          </p>
          <a
            href={EDITOR_URL}
            className="group mt-8 inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-[14px] font-medium text-white shadow-[0_10px_28px_-10px_rgb(0_0_0/0.55)] transition-transform active:scale-[0.97]"
          >
            Open the editor
            <RiArrowRightLine className="size-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </div>
      </Reveal>

      <div className="mx-auto mt-10 flex max-w-6xl flex-wrap items-center justify-between gap-4 text-[12.5px] text-ink-faint">
        <Logo className="text-ink" />
        <div className="flex gap-5">
          <a className="hover:text-ink" href="#features">
            Features
          </a>
          <a className="hover:text-ink" href="#roadmap">
            Roadmap
          </a>
          <a className="hover:text-ink" href={REPO_URL}>
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
