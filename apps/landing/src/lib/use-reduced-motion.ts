import { useReducedMotion as useMotionPreference } from "motion/react";
import { useEffect, useState } from "react";

/** Reduced-motion preference that matches the prerendered HTML on first render. */
export function useReducedMotion() {
  const preference = useMotionPreference();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated && preference === true;
}
