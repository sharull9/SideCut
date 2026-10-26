import { useInView } from "motion/react";
import { useReducedMotion } from "./use-reduced-motion";
import { useEffect, useRef, useState } from "react";

/**
 * Steps through a scripted demo while it is on screen.
 * Reduced motion pins the demo to its final, fully explained state.
 */
export function useDemoLoop(durations: readonly number[]) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const running = inView && !reduce;

  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(
      () => setStep((current) => (current + 1) % durations.length),
      durations[step],
    );
    return () => window.clearTimeout(id);
  }, [running, step, durations]);

  return { ref, step: reduce ? durations.length - 1 : step, reduce };
}
