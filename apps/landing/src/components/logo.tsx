// Viewfinder mark; the source files live in public/brand.
const FRAME =
  "M13 4H8a4 4 0 0 0-4 4v16a4 4 0 0 0 4 4h5M19 4h5a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4h-5M7.25 16h1.5M23.25 16h1.5";

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={`block ${className}`} aria-hidden>
      <path
        d={FRAME}
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The lens fills like a record button on hover. */}
      <circle
        cx={16}
        cy={16}
        r={3.75}
        stroke="var(--color-brand)"
        strokeWidth={2.25}
        className="fill-transparent transition-[fill] duration-200 group-hover/logo:fill-brand"
      />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`group/logo inline-flex items-center gap-2 ${className}`}>
      <LogoMark className="size-6" />
      <span className="text-[15px] leading-none font-semibold tracking-[-0.02em]">raE.E</span>
    </span>
  );
}
