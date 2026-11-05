"use client";

import { useEffect, useRef, useState } from "react";

const esc = (c: string) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c);

const cellHtml = (c: string) =>
  c === " " ? '<span class="lf-sp"></span>' : `<span class="lf-ch${c === "…" ? " lf-el" : ""}"><i>${esc(c)}</i></span>`;

const build = (text: string) => Array.from(text).map(cellHtml).join("");

const EASE = "cubic-bezier(.16,1,.3,1)";

type Cell = HTMLElement & { _hot?: number; _cool?: number };

/** Rolls one character cell to `c`: the old glyph leaves upward, the new one rises in. */
function roll(el: Cell, c: string, delay: number) {
  const kids = el.querySelectorAll("i");
  for (let k = 0; k < kids.length - 1; k++) kids[k].remove();
  const old = el.querySelector("i");
  if (!old) return;
  old.getAnimations().forEach((a) => a.cancel());
  old.className = "";
  const nu = document.createElement("i");
  nu.textContent = c;
  nu.className = "lf-in";
  el.appendChild(nu);
  window.clearTimeout(el._hot);
  window.clearTimeout(el._cool);
  el._hot = window.setTimeout(() => el.classList.add("lf-hot"), delay);
  const o: KeyframeAnimationOptions = { duration: 560, delay, easing: EASE, fill: "both" };
  old.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-108%)", opacity: 0 }], o);
  const a = nu.animate([{ transform: "translateY(108%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], o);
  a.onfinish = () => {
    if (old.parentNode) old.remove();
    nu.className = "";
    a.cancel();
    el._cool = window.setTimeout(() => el.classList.remove("lf-hot"), 650);
  };
}

/**
 * A mono address line where only the characters that differ from the previous
 * value roll. Rendered once on the server; later updates are applied to the
 * DOM directly so React never re-creates the cells mid-animation.
 */
export function AddressRoll({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [initial] = useState(() => build(text));
  const prev = useRef(text);

  useEffect(() => {
    const host = ref.current;
    if (!host || prev.current === text) return;
    const before = Array.from(prev.current);
    const after = Array.from(text);
    prev.current = text;
    const cells = Array.from(host.children) as Cell[];
    const sameShape =
      before.length === after.length && cells.length === after.length && after.every((c, i) => (c === " ") === (before[i] === " ") && (c === "…") === (before[i] === "…"));
    if (!sameShape) {
      host.innerHTML = build(text);
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof Element.prototype.animate !== "function";
    let k = 0;
    after.forEach((c, i) => {
      if (before[i] === c) return;
      const cell = cells[i];
      if (still) {
        const g = cell.querySelector("i");
        if (g) g.textContent = c;
        return;
      }
      roll(cell, c, k++ * 15);
    });
  }, [text]);

  return <span ref={ref} className={`lf-roll${className ? ` ${className}` : ""}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: initial }} />;
}
