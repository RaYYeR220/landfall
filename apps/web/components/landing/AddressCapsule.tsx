"use client";

import { useEffect, useRef, useState } from "react";
import { AddressRoll } from "./AddressRoll";
import { ADDRESSES, compactText, fullText } from "./chains";

/** Share of the rail replay spent on each of the three segments. */
const SEG = [0.38, 0.47, 0.15];
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function AddressCapsule() {
  const rootRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const headRef = useRef<HTMLSpanElement>(null);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hold = useRef(0);
  const toastTimer = useRef(0);
  const [cur, setCur] = useState(0);
  const [inView, setInView] = useState(false);
  const [toast, setToast] = useState(false);
  const c = ADDRESSES[cur];

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver((es) => setInView(es.some((e) => e.isIntersecting)), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Replay Detected → Swapped → Landed → Lending for the current address, then move on.
  useEffect(() => {
    const rail = railRef.current;
    const fill = fillRef.current;
    const head = headRef.current;
    if (!rail || !fill || !head) return;
    const steps = stepRefs.current;
    const setFill = (f: number) => {
      fill.style.transform = `scaleX(${f})`;
      head.style.left = `calc(12.5% + ${75 * f}%)`;
    };
    const setNodes = (k: number, complete = false) =>
      steps.forEach((s, i) => {
        s?.classList.toggle("lf-done", i < k || (complete && i <= k));
        s?.classList.toggle("lf-on", i === k && !complete);
      });
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !inView) {
      rail.classList.remove("lf-rewind");
      rail.classList.add("lf-idle");
      setFill(1);
      setNodes(3);
      return;
    }
    let alive = true;
    let raf = 0;
    let timer = 0;
    rail.classList.add("lf-rewind");
    setNodes(-1);
    setFill(0);
    timer = window.setTimeout(() => {
      if (!alive) return;
      rail.classList.remove("lf-rewind", "lf-idle");
      const ms = ADDRESSES[cur].ms;
      let t0: number | null = null;
      const frame = (ts: number) => {
        if (!alive) return;
        if (t0 === null) t0 = ts;
        const p = Math.min(1, (ts - t0) / ms);
        let acc = 0;
        let f = 1;
        for (let s = 0; s < 3; s++) {
          if (p <= acc + SEG[s]) {
            f = (s + ease((p - acc) / SEG[s])) / 3;
            break;
          }
          acc += SEG[s];
        }
        setFill(f);
        setNodes(Math.min(3, Math.floor(f * 3 + 1e-4)));
        if (p < 1) {
          raf = requestAnimationFrame(frame);
          return;
        }
        rail.classList.add("lf-idle");
        setNodes(3);
        const wait = Math.max(1300, 4200 - ms, hold.current - performance.now());
        timer = window.setTimeout(() => setCur((i) => (i + 1) % ADDRESSES.length), wait);
      };
      raf = requestAnimationFrame(frame);
    }, 320);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [cur, inView]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const pick = (i: number) => {
    hold.current = performance.now() + 9000;
    setCur(i);
  };

  const copy = () => {
    try {
      void navigator.clipboard?.writeText(`${fullText(c.groups)} (sample)`).catch(() => {});
    } catch {
      /* clipboard unavailable: the toast still explains */
    }
    setToast(true);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(false), 2400);
  };

  return (
    <div className="lf-capsule" ref={rootRef}>
      <div className="lf-cap-head">
        <span>
          <span className="lf-only-wide">Permanent deposit address</span>
          <span className="lf-only-narrow">Deposit address</span> ·{" "}
          <b key={c.key} className="lf-swap">
            {c.key === "evm" ? "EVM, 7 chains" : c.name}
          </b>
        </span>
        <span className="lf-cap-tags">
          <span className="lf-tag">sample</span>
          <span className="lf-tag lf-only-wide">timings illustrative</span>
        </span>
      </div>

      <div className="lf-cap-field">
        <p className="lf-cap-line">
          <AddressRoll text={fullText(c.groups)} className="lf-only-wide" />
          <AddressRoll text={compactText(c.groups)} className="lf-only-narrow" />
          <span className="lf-sr">
            {c.name} deposit address, sample: {fullText(c.groups)}
          </span>
        </p>
        <button type="button" className="lf-copybtn" onClick={copy} aria-label="Copy sample address">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="5.2" y="5.2" width="8.3" height="8.3" rx="2" stroke="currentColor" strokeWidth="1.3" />
            <path d="M10.6 3.2V3A1.5 1.5 0 0 0 9.1 1.5H4A2.5 2.5 0 0 0 1.5 4v5.1A1.5 1.5 0 0 0 3 10.6h.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <span className="lf-copybtn-t">Copy</span>
        </button>
      </div>

      <div className="lf-cap-req">
        <svg className="lf-cap-ic" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r=".85" fill="currentColor" />
        </svg>
        <span key={c.req} className="lf-cap-req-t lf-swap">
          {c.req}
        </span>
        {c.memo ? (
          <span className="lf-memo">
            Memo <span className="mono">{c.memo}</span> <small>required</small>
          </span>
        ) : null}
        <span className="lf-eta">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5.8" stroke="currentColor" strokeWidth="1.15" />
            <path d="M7 4v3.2l2 1.3" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" />
          </svg>
          {c.time ? `Lands in ${c.time}` : "Timing varies"}
        </span>
      </div>

      <div className="lf-chips" role="group" aria-label="Source network">
        {ADDRESSES.map((a, i) => (
          <button key={a.key} type="button" className="lf-chip" aria-pressed={i === cur} onClick={() => pick(i)}>
            {a.name}
            {a.chipSub ? <small>{a.chipSub}</small> : null}
          </button>
        ))}
      </div>

      <div className="lf-rail lf-idle" ref={railRef} aria-label="Deposit lifecycle, sample">
        <span className="lf-track" />
        <span className="lf-fill" ref={fillRef} />
        <span className="lf-head" ref={headRef} />
        {[
          { t: "Detected", m: c.detected },
          { t: "Swapped to USDC", m: "via Aurora Intents" },
          { t: "Landed as lfUSDC", m: c.time ? `on Solana · ${c.time}` : "on Solana" },
          { t: "Lending", m: "Kamino 60 · Jupiter Lend 40", split: true },
        ].map((s, i) => (
          <div
            key={s.t}
            className="lf-rstep lf-done"
            ref={(el) => {
              stepRefs.current[i] = el;
            }}
          >
            <span className="lf-node" />
            <div className="lf-rst">{s.t}</div>
            <div className="lf-rmeta">{s.m}</div>
            {s.split ? (
              <span className="lf-split" aria-hidden="true">
                <i />
                <i />
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div className={`lf-toast${toast ? " lf-toast-on" : ""}`} role="status" aria-live="polite">
        {toast ? "Sample copied. Get your own address to deposit." : ""}
      </div>
    </div>
  );
}
