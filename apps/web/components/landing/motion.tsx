"use client";
/**
 * Landing-page motion helpers. Everything is transform/opacity driven, starts only
 * when the element is on screen, and collapses to the final state under
 * `prefers-reduced-motion`.
 */
import { cn } from "cn";
import {
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** True once (or while, with `once: false`) the element intersects the viewport. */
export function useInView<T extends Element = HTMLDivElement>({
  once = true,
  rootMargin = "0px 0px -12% 0px",
  threshold = 0.15,
}: {
  once?: boolean;
  rootMargin?: string;
  threshold?: number;
} = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) io.disconnect();
        } else if (!once) setInView(false);
      },
      { rootMargin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once, rootMargin, threshold]);
  return [ref, inView];
}

/**
 * Marks a block as revealed when it scrolls in. Descendants with `lp-rv` fade up,
 * staggered by their `--i` custom property (see landing.css).
 */
export function Reveal({
  as: Tag = "div",
  className,
  style,
  children,
  id,
  threshold,
}: {
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  id?: string;
  threshold?: number;
}) {
  const [ref, inView] = useInView<HTMLElement>({ threshold });
  return (
    <Tag ref={ref} id={id} className={className} style={style} data-in={inView ? "" : undefined}>
      {children}
    </Tag>
  );
}

/** Stagger index for an `lp-rv` child. */
export const rv = (i: number): CSSProperties => ({ "--i": i }) as CSSProperties;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** Tweens a number towards `to` whenever `to` changes (and `run` is true). */
export function useTween(to: number, { run = true, duration = 1100, from = 0 } = {}): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(from);
  const current = useRef(from);
  useEffect(() => {
    if (!run) return;
    if (reduced) {
      current.current = to;
      setValue(to);
      return;
    }
    const start = current.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const v = start + (to - start) * easeOut(t);
      current.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, run, duration, reduced]);
  return value;
}

/** Counts up to `value` the first time it scrolls into view. */
export function CountUp({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  duration = 1400,
  className,
  locale = true,
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
  locale?: boolean;
}) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const v = useTween(value, { run: inView, duration });
  const text = locale
    ? v.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : v.toFixed(decimals);
  return (
    <span ref={ref} className={cn("num", className)}>
      {prefix}
      {text}
      {suffix}
    </span>
  );
}

/** Runs `fn` every `ms` while `active`; stops when the tab is hidden. */
export function useInterval(fn: () => void, ms: number, active = true) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (!document.hidden) saved.current();
    }, ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
}
