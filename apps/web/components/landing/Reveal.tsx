"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Fades its content in when it scrolls into view. Failsafes: without JS a CSS
 * animation shows it after 2.6 s; with JS, a periodic on-screen check shows it
 * even if the observer never fires, and everything is shown after 3.5 s;
 * reduced motion shows it at once.
 */
export function Reveal({ children, className = "", delay, id }: { children: ReactNode; className?: string; delay?: string; id?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      setShown(true);
      return;
    }
    setArmed(true);
    let done = false;
    const show = () => {
      if (done) return;
      done = true;
      setShown(true);
      io.disconnect();
      window.clearInterval(check);
      window.clearTimeout(late);
    };
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && show(), { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    const check = window.setInterval(() => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) show();
    }, 1200);
    // never leave content hidden for long: full-page captures and readers who jump straight to a section
    const late = window.setTimeout(show, 3500);
    return () => {
      io.disconnect();
      window.clearInterval(check);
      window.clearTimeout(late);
    };
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      className={`lf-rv${armed ? " lf-rv-armed" : ""}${shown ? " lf-rv-in" : ""}${className ? ` ${className}` : ""}`}
      style={delay ? ({ "--d": delay } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}
