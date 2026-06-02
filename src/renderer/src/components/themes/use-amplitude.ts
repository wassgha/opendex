import { useEffect, useRef } from "react";

/**
 * Runs a requestAnimationFrame loop that samples `getAmplitude` each frame and
 * hands a smoothed value to `apply` (which should mutate DOM/refs directly — no
 * React state — so 60fps motion costs nothing). Pauses when `active` is false.
 */
export function useAmplitudeFrame(
  getAmplitude: () => number,
  active: boolean,
  apply: (smoothed: number) => void,
) {
  const smoothedRef = useRef(0);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const getRef = useRef(getAmplitude);
  getRef.current = getAmplitude;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const target = active ? getRef.current() : 0;
      // Asymmetric smoothing: rise fast, fall slow — reads as natural.
      const cur = smoothedRef.current;
      const k = target > cur ? 0.45 : 0.12;
      smoothedRef.current = cur + (target - cur) * k;
      applyRef.current(smoothedRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

export const ACTIVE_STATES = new Set<string>([
  "listening_wake",
  "active_listening",
  "follow_up_listening",
  "thinking",
  "speaking",
]);
