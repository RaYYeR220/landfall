import { GROUPS, LEFT, RIGHT, type Arm, type Group } from "./chains";

/**
 * The hero object: deposit streaks spiral in from every source chain into one
 * lfUSDC core on Solana, which sheds a Kamino stream and a Jupiter Lend stream.
 * Each arm is one chain; spiral length follows its typical arrival time.
 * A featured deposit chip rides its arm into the core and turns into lfUSDC.
 */

type Chain = Arm & { gr: (typeof GROUPS)[Group]; side: "L" | "R"; phi: number; Th: number; i: number };
type Disc = { ch: Chain; s0: number; dth: number; dr: number; sz: number; sp: number };
type Pt = { x: number; y: number };
type Stream = { dir: number; w: number; pts: Pt[]; parts: { u0: number; off: number; sz: number; sp: number }[]; name: string; pct: string; mid: Pt };
type Feat = { ch: Chain; t0: number; T: number; from: string; to: string };
type Rec = [number, number, number, number, number];

export type VortexOptions = {
  hero: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The core sits just below this element (the address readout). */
  anchor: HTMLElement;
  /** Pointer over these elements does not light an arm. */
  exclude: HTMLElement[];
  reduced: boolean;
  onActive: (armId: string) => void;
};

export type Vortex = {
  destroy(): void;
  /** Drop a featured deposit on an arm (falls back to the first arm if it is not shown). */
  drop(armId: string, from?: string, to?: string): void;
  /** Curator weights in percent, for the two streams. */
  setWeights(kamino: number, jupiterLend: number): void;
};

const SANS = '"Satoshi", ui-sans-serif, system-ui, sans-serif';
const INK = "233,235,238";
const ICE = "95,212,244";
const I = (a: number) => `rgba(${INK},${a})`;
const C = (a: number) => `rgba(${ICE},${a})`;

const MOB_L: Record<string, number> = { trx: 128, base: 152, eth: 208, arb: 232 };
const MOB_R: Record<string, number> = { btc: 52, sol: 28, ton: -28, near: -52 };

const CHIPS: Record<string, [string, string][]> = {
  trx: [["250 USDT · Tron", "249.9 lfUSDC"], ["2,000 TRX · Tron", "→ lfUSDC"]],
  base: [["0.4 ETH · Base", "→ lfUSDC"], ["600 USDC · Base", "599.8 lfUSDC"]],
  eth: [["1,200 USDT · Ethereum", "1,199.5 lfUSDC"]],
  arb: [["500 USDC · Arbitrum", "499.8 lfUSDC"]],
  op: [["75 USDC · Optimism", "74.97 lfUSDC"]],
  pol: [["60 USDC · Polygon", "59.98 lfUSDC"]],
  bnb: [["320 USDT · BNB Chain", "319.9 lfUSDC"]],
  avax: [["900 USDC · Avalanche", "899.6 lfUSDC"]],
  btc: [["0.02 BTC · Bitcoin", "→ lfUSDC"]],
  sol: [["3 SOL · Solana", "→ lfUSDC"], ["400 USDC · Solana", "399.8 lfUSDC"]],
  ton: [["150 USDT · TON", "149.9 lfUSDC"], ["40 TON · TON", "→ lfUSDC"]],
};
const SCRIPT = ["trx", "base", "btc", "arb", "ton", "sol", "eth", "trx", "bnb", "base", "op", "ton"];
const FEAT_EVERY = 4.2;
const FROZEN_NOW = 7.3;
const BUCKETS = 9;
const LOG = Math.log(0.07);

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const frac = (x: number) => x - Math.floor(x);
function gauss() {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

export function startVortex(o: VortexOptions): Vortex {
  const { hero, canvas: cvs, anchor, exclude, reduced: RM, onActive } = o;
  const ctx = cvs.getContext("2d");
  if (!ctx) return { destroy() {}, drop() {}, setWeights() {} };

  let W = 0, H = 0, dpr = 1, mob = false, cx = 0, cy = 0, rx = 0, ry = 0;
  let chains: Chain[] = [];
  let discs: Disc[] = [];
  let streams: Stream[] = [];
  let feats: Feat[] = [];
  let arrival: { from: string; to: string; t0: number } | null = null;
  let boost = 0;
  let hl = -1, userUntil = 0, autoHl = -1, scriptI = 0, nextFeat = 0, t0 = 0, ist = -10;
  let frozen = false, booted = false, dead = false;
  let weights = { k: 60, j: 40 };
  let lastActive = "";
  let sig = "";
  const chipI: Record<string, number> = {};

  const byId = (id: string) => chains.find((c) => c.id === id);

  function spiral(ch: Chain, s: number, dth: number, dr: number) {
    const r = (1 + dr) * Math.pow(1 - s, 1.25);
    const th = ch.phi + dth + ch.Th * (Math.log(1 - 0.93 * s) / LOG);
    return { x: cx + r * rx * Math.cos(th), y: cy + r * ry * Math.sin(th), r, th };
  }

  function buildStreams() {
    const Ls = H - cy;
    const sp = mob ? 54 : rx * 0.18;
    const tot = weights.k + weights.j || 100;
    const mk = (dir: number, share: number, name: string): Stream => {
      const w = 1.4 + 6 * share;
      const p0 = { x: cx, y: cy + 5 };
      const p1 = { x: cx + dir * 4, y: cy + Ls * 0.34 };
      const p2 = { x: cx + dir * sp, y: cy + Ls * 0.5 };
      const p3 = { x: cx + dir * sp * 1.04, y: H + 8 };
      const pts: Pt[] = [];
      for (let i = 0; i <= 60; i++) pts.push(cubic(p0, p1, p2, p3, i / 60));
      const n = Math.round((mob ? 56 : 86) * share);
      const parts = Array.from({ length: n }, () => ({ u0: Math.random(), off: gauss() * w * 0.5, sz: 0.7 + Math.random() * 0.6, sp: 0.85 + Math.random() * 0.3 }));
      let mid = pts[pts.length - 1];
      for (const q of pts) if (q.y >= H - (mob ? 92 : 70)) { mid = q; break; }
      return { dir, w, pts, parts, name, pct: `${Math.round(share * 100)}%`, mid };
    };
    streams = [mk(-1, weights.k / tot, "Kamino"), mk(1, weights.j / tot, "Jupiter Lend")];
  }

  function layout() {
    const r = hero.getBoundingClientRect();
    W = Math.round(r.width);
    H = Math.round(r.height);
    if (!W || !H) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
    mob = W < 720;
    cx = W / 2;
    const ab = anchor.getBoundingClientRect().bottom - r.top;
    if (!mob) {
      rx = Math.min(W * 0.43, 600);
      cy = ab + 44;
      ry = Math.min(rx * 0.275, Math.max(70, H - cy - 70));
    } else {
      rx = W * 0.4;
      ry = rx * 0.5;
      cy = ab + ry * 0.8 + 22;
    }
    const D2R = Math.PI / 180;
    chains = [];
    const add = (arr: Arm[], side: "L" | "R", angOf: (id: string, k: number) => number | null) =>
      arr.forEach((arm, k) => {
        const a = angOf(arm.id, k);
        if (a === null) return;
        const gr = GROUPS[arm.group];
        chains.push({ ...arm, gr, side, phi: a * D2R, Th: (mob ? 0.42 : 0.5) * gr.T, i: chains.length });
      });
    if (!mob) {
      add(LEFT, "L", (_id, k) => 118 + k * 12);
      add(RIGHT, "R", (_id, k) => 62 - k * 12);
    } else {
      add(LEFT, "L", (id) => MOB_L[id] ?? null);
      add(RIGHT, "R", (id) => MOB_R[id] ?? null);
    }
    // equal spawn rate per chain, so slow chains keep more streaks in the field
    const N = mob ? 760 : 1500;
    const sumT = chains.reduce((a, c) => a + c.gr.T, 0);
    discs = [];
    for (const ch of chains) {
      const n = Math.round((N * ch.gr.T) / sumT);
      for (let i = 0; i < n; i++) discs.push({ ch, s0: Math.random(), dth: gauss() * 0.03, dr: Math.random() * 0.1, sz: 0.6 + Math.random() * 0.6, sp: 0.92 + Math.random() * 0.16 });
    }
    buildStreams();
    feats = [];
    arrival = null;
    hl = -1;
    const keep = lastActive ? byId(lastActive) : undefined;
    autoHl = keep ? keep.i : -1;
  }

  const streamAt = (st: Stream, u: number) => {
    const f = u * 60;
    const i = Math.min(59, Math.floor(f));
    const k = f - i;
    const a = st.pts[i];
    const b = st.pts[i + 1];
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, dx: b.x - a.x, dy: b.y - a.y };
  };

  function fire(ch: Chain | undefined, now: number) {
    if (!ch) return;
    const list = CHIPS[ch.id] ?? [[`Deposit · ${ch.name}`, "→ lfUSDC"]];
    chipI[ch.id] = ((chipI[ch.id] ?? -1) + 1) % list.length;
    const [from, to] = list[chipI[ch.id]];
    feats.push({ ch, t0: now, T: ch.gr.T, from, to });
    autoHl = ch.i;
  }

  function chip(x: number, y: number, text: string, a: number, ice: boolean, align: "l" | "r" | "c") {
    const g = ctx!;
    g.font = `500 ${mob ? 11 : 12}px ${SANS}`;
    const w = g.measureText(text).width + 22;
    const h = 24;
    let bx = align === "r" ? x - w : align === "c" ? x - w / 2 : x;
    bx = clamp(bx, 10, W - w - 10);
    g.globalAlpha = a;
    g.beginPath();
    g.roundRect(bx, y - h / 2, w, h, h / 2);
    g.fillStyle = "rgba(16,18,22,.94)";
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = ice ? C(0.45) : I(0.16);
    g.stroke();
    g.fillStyle = ice ? C(1) : I(0.92);
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(text, bx + 11, y + 0.5);
    g.globalAlpha = 1;
  }

  function detail(ch: Chain) {
    if (mob) return ch.gr.time ? `${ch.gr.time} · illustrative` : "timing varies";
    if (ch.group === "evm") return `${ch.gr.time} · one EVM address · illustrative`;
    if (ch.gr.time) return `${ch.gr.assets} · ${ch.gr.time} · illustrative`;
    if (ch.id === "xlm") return "address + memo · timing varies";
    if (ch.id === "cex") return "withdraw to your address · timing varies";
    return "own address · timing varies";
  }

  const bk: Rec[][] = [];
  const bkHi: Rec[][] = [];
  const bkIce: Rec[][] = [];

  function render(now: number, dt: number) {
    const g = ctx!;
    const t = now - t0;
    const it = now - ist;
    const intro = frozen ? 1 : easeOut(clamp((it - 0.1) / 1.6));
    const active = now < userUntil ? hl : autoHl;
    const act = chains[active];
    if (act && act.id !== lastActive) {
      lastActive = act.id;
      onActive(act.id);
    }

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cvs.width, cvs.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // streaks, bucketed by alpha so ~1,500 of them cost ~20 strokes
    for (let i = 0; i < BUCKETS; i++) {
      bk[i] = [];
      bkHi[i] = [];
      bkIce[i] = [];
    }
    for (const d of discs) {
      const ch = d.ch;
      const T = ch.gr.T * d.sp;
      const s = frac(t / T + d.s0);
      const p = spiral(ch, s, d.dth, d.dr);
      const q0 = spiral(ch, Math.max(0, s - 0.075 / T), d.dth, d.dr);
      const depth = (Math.sin(p.th) + 1) / 2;
      let a = (0.26 + 0.56 * depth) * clamp(s / 0.05) * (0.62 + 0.38 * (1 - p.r)) * intro;
      const on = active === ch.i;
      if (active >= 0 && !on) a *= 0.62;
      if (on) a = Math.min(1, a * 1.2 + 0.3);
      const w = d.sz * (0.8 + 0.8 * depth) * (on ? 1.3 : 1);
      const q = Math.min(BUCKETS - 1, Math.floor(a * BUCKETS));
      const rec: Rec = [q0.x, q0.y, p.x, p.y, w];
      if (p.r < 0.07) bkIce[q].push(rec);
      else if (on) bkHi[q].push(rec);
      else bk[q].push(rec);
    }
    g.lineCap = "round";
    const flush = (arr: Rec[][], col: (a: number) => string) => {
      for (let i = 0; i < BUCKETS; i++) {
        const L = arr[i];
        if (!L.length) continue;
        g.strokeStyle = col((i + 0.5) / BUCKETS);
        for (const wide of [false, true]) {
          g.beginPath();
          g.lineWidth = wide ? 1.6 : 1.05;
          let any = false;
          for (const [x0, y0, x1, y1, w] of L) {
            if (w > 1.3 !== wide) continue;
            g.moveTo(x0, y0);
            g.lineTo(x1 + 0.01, y1);
            any = true;
          }
          if (any) g.stroke();
        }
      }
    };
    flush(bk, I);
    flush(bkHi, (a) => I(Math.min(1, a * 1.1)));
    flush(bkIce, (a) => C(Math.min(1, a + 0.2)));

    // the two strategy streams the core sheds
    for (const st of streams) {
      g.beginPath();
      g.moveTo(st.pts[0].x, st.pts[0].y);
      for (const p of st.pts) g.lineTo(p.x, p.y);
      g.strokeStyle = C(0.1 * intro);
      g.lineWidth = st.w * 0.42;
      g.stroke();
      g.fillStyle = C(0.62 * intro);
      g.beginPath();
      for (const pt of st.parts) {
        const u = frac(t / (2.9 * pt.sp) + pt.u0);
        const e = u * u * 0.4 + u * 0.6;
        const q = streamAt(st, e);
        const len = Math.hypot(q.dx, q.dy) || 1;
        const x = q.x + (-q.dy / len) * pt.off;
        const y = q.y + (q.dx / len) * pt.off;
        const r = pt.sz * (1 + e * 0.5);
        g.moveTo(x + r, y);
        g.arc(x, y, r, 0, 6.2832);
      }
      g.fill();
    }

    // core
    boost *= Math.exp(-(dt || 0) / 0.55);
    const gR = (mob ? 46 : 78) * (1 + 0.35 * boost);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, gR);
    grad.addColorStop(0, C(0.34 + 0.3 * boost));
    grad.addColorStop(0.35, C(0.09 + 0.08 * boost));
    grad.addColorStop(1, C(0));
    g.fillStyle = grad;
    g.globalAlpha = intro;
    g.beginPath();
    g.arc(cx, cy, gR, 0, 6.2832);
    g.fill();
    g.beginPath();
    g.arc(cx, cy, 4.4 + boost * 1.4, 0, 6.2832);
    g.fillStyle = C(1);
    g.fill();
    g.beginPath();
    g.arc(cx, cy, 1.8, 0, 6.2832);
    g.fillStyle = "#f4fdff";
    g.fill();
    g.globalAlpha = 1;

    // featured deposits ride their chain's spiral with a chip attached
    for (let i = feats.length - 1; i >= 0; i--) {
      const f = feats[i];
      const s = (now - f.t0) / f.T;
      if (s >= 1) {
        if (!frozen) {
          arrival = { from: f.from, to: f.to, t0: now };
          boost = 1;
        }
        feats.splice(i, 1);
        continue;
      }
      if (s < 0) continue;
      const dim = active >= 0 && active !== f.ch.i ? 0.6 : 1;
      for (let k = 6; k >= 1; k--) {
        const pp = spiral(f.ch, Math.max(0, s - k * 0.012), 0, 0);
        g.beginPath();
        g.arc(pp.x, pp.y, 1.6, 0, 6.2832);
        g.fillStyle = I(((0.12 * (7 - k)) / 6) * dim);
        g.fill();
      }
      const p = spiral(f.ch, s, 0, 0);
      g.beginPath();
      g.arc(p.x, p.y, 2.6, 0, 6.2832);
      g.fillStyle = I(dim);
      g.fill();
      const a = clamp(s / 0.04) * clamp((1 - s) / 0.05) * dim;
      chip(p.x + (p.x < cx ? -12 : 12), p.y - 16, f.from, a, false, p.x < cx ? "r" : "l");
    }
    if (arrival) {
      const age = now - arrival.t0;
      const m = easeOut(clamp(age / 0.5));
      const out = frozen ? 1 : clamp((3.0 - age) / 0.5);
      if (out <= 0) arrival = null;
      else {
        const ax = mob ? cx : cx - 18;
        const ay = mob ? cy - 40 : cy + 30;
        const al = mob ? "c" : "r";
        if (m < 1) chip(ax, ay + (1 - m) * 8, arrival.from, (1 - m) * out, false, al);
        chip(ax, ay - (1 - m) * 6, arrival.to, m * out, true, al);
      }
    }

    // chain labels sit on the ellipse (no ring drawn)
    g.textBaseline = "middle";
    const fs = mob ? 11 : 12.5;
    const off = mob ? 6 : 9;
    const litY = act ? cy + ry * Math.sin(act.phi) + Math.sin(act.phi) * off + fs + 4 : -1e9;
    for (const ch of chains) {
      const a0 = frozen ? 1 : clamp((it - 0.5 - ch.i * 0.03) / 0.6);
      if (a0 <= 0) continue;
      const on = active === ch.i;
      const isVar = ch.group === "var";
      const ax = cx + rx * Math.cos(ch.phi);
      const ay = cy + ry * Math.sin(ch.phi);
      // a lit chain's detail line takes the row below it; the neighbour there steps back
      if (act && !on && ch.side === act.side && Math.abs(ay + Math.sin(ch.phi) * off - litY) < fs + 2) continue;
      g.beginPath();
      g.arc(ax, ay, on ? 2.2 : 1.5, 0, 6.2832);
      g.fillStyle = I((on ? 0.95 : 0.45) * a0);
      g.fill();
      const tx = ax + (ch.side === "L" ? -12 : 12);
      const ty = ay + Math.sin(ch.phi) * off;
      g.font = `${on ? 700 : 500} ${fs}px ${SANS}`;
      const nameA = (active >= 0 ? (on ? 1 : isVar ? 0.4 : 0.58) : isVar ? 0.46 : 0.74) * a0;
      g.fillStyle = I(nameA);
      const w = g.measureText(ch.name).width;
      let x = ch.side === "L" ? tx - w : tx;
      x = clamp(x, 12, W - w - 12);
      g.textAlign = "left";
      g.fillText(ch.name, x, ty);
      if (on) {
        const det = detail(ch);
        g.font = `400 ${fs - 1}px ${SANS}`;
        const w2 = g.measureText(det).width;
        let x2 = ch.side === "L" ? tx - w2 : tx;
        x2 = clamp(x2, 12, W - w2 - 12);
        g.fillStyle = I(0.62 * a0);
        g.fillText(det, x2, ty + fs + 4);
      }
    }

    // core label
    g.globalAlpha = intro;
    const cf = mob ? 11.5 : 12.5;
    g.font = `700 ${cf}px ${SANS}`;
    const lw = g.measureText("lfUSDC").width;
    g.font = `400 ${cf}px ${SANS}`;
    const sw = g.measureText(" · Solana").width;
    const lx = cx + 16;
    const ly = cy + 2;
    g.beginPath();
    g.roundRect(lx, ly - 12, lw + sw + 20, 24, 12);
    g.fillStyle = "rgba(13,14,17,.82)";
    g.fill();
    g.strokeStyle = C(0.28);
    g.lineWidth = 1;
    g.stroke();
    g.textAlign = "left";
    g.font = `700 ${cf}px ${SANS}`;
    g.fillStyle = C(1);
    g.fillText("lfUSDC", lx + 10, ly + 0.5);
    g.font = `400 ${cf}px ${SANS}`;
    g.fillStyle = I(0.66);
    g.fillText(" · Solana", lx + 10 + lw, ly + 0.5);

    // stream labels
    const sf = mob ? 11 : 12.5;
    for (const st of streams) {
      const p = st.mid;
      const name = st.name + "  ";
      g.font = `500 ${sf}px ${SANS}`;
      const w1 = g.measureText(name).width;
      g.font = `700 ${sf}px ${SANS}`;
      const w2 = g.measureText(st.pct).width;
      const x = st.dir < 0 ? p.x - 16 - w1 - w2 : p.x + 16;
      g.font = `500 ${sf}px ${SANS}`;
      g.fillStyle = I(0.66);
      g.fillText(name, x, p.y);
      g.font = `700 ${sf}px ${SANS}`;
      g.fillStyle = C(0.95);
      g.fillText(st.pct, x + w1, p.y);
    }
    g.globalAlpha = 1;
  }

  function freeze() {
    frozen = true;
    t0 = 0;
    const now = FROZEN_NOW;
    const tn = byId("ton");
    const tr = byId("trx");
    feats = [];
    if (tn) feats.push({ ch: tn, t0: now - 0.35 * tn.gr.T, T: tn.gr.T, from: "150 USDT · TON", to: "149.9 lfUSDC" });
    if (tr) {
      feats.push({ ch: tr, t0: now - 0.3 * tr.gr.T, T: tr.gr.T, from: "250 USDT · Tron", to: "249.9 lfUSDC" });
      if (autoHl < 0) autoHl = tr.i;
    }
    arrival = { from: "500 USDC · Arbitrum", to: "499.8 lfUSDC", t0: now - 1 };
    boost = 0.4;
    render(now, 0);
  }

  // ---------- loop ----------
  let raf = 0;
  let last = 0;
  let running = false;
  let pageVisible = !document.hidden;
  let onScreen = true;
  function frame(ts: number) {
    const now = ts / 1000;
    const dt = Math.min(0.05, now - (last || now));
    last = now;
    if (now >= nextFeat) {
      fire(byId(SCRIPT[scriptI++ % SCRIPT.length]) ?? chains[(Math.random() * chains.length) | 0], now);
      nextFeat = now + FEAT_EVERY;
    }
    render(now, dt);
    if (running) raf = requestAnimationFrame(frame);
  }
  const sync = () => {
    if (!booted || frozen || dead) return;
    const go = pageVisible && onScreen;
    if (go && !running) {
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    } else if (!go && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  };

  // ---------- interaction: the cursor's angle lights the nearest arm ----------
  function nearest(mx: number, my: number) {
    const ang = Math.atan2((my - cy) / ry, (mx - cx) / rx);
    let best: Chain | undefined;
    let bd = 1e9;
    for (const ch of chains) {
      const d = Math.abs(((((ang - ch.phi) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      if (d < bd) {
        bd = d;
        best = ch;
      }
    }
    return best;
  }
  const excluded = (x: number, y: number) =>
    exclude.some((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  const local = (e: MouseEvent) => {
    const r = hero.getBoundingClientRect();
    return { mx: e.clientX - r.left, my: e.clientY - r.top };
  };

  const onMove = (e: PointerEvent) => {
    if (!booted || e.pointerType === "touch") return;
    const { mx, my } = local(e);
    if (my < 70 || excluded(e.clientX, e.clientY) || Math.hypot((mx - cx) / rx, (my - cy) / ry) < 0.12) {
      hero.style.cursor = "";
      return;
    }
    const ch = nearest(mx, my);
    if (!ch) return;
    hl = ch.i;
    userUntil = performance.now() / 1000 + 2.2;
    hero.style.cursor = "pointer";
    if (frozen) {
      autoHl = hl;
      render(FROZEN_NOW, 0);
    }
  };
  const onLeave = () => {
    userUntil = 0;
    hero.style.cursor = "";
  };
  const onClick = (e: MouseEvent) => {
    if (!booted || (e.target as Element | null)?.closest("a,button,dialog")) return;
    const { mx, my } = local(e);
    if (my < 70 || excluded(e.clientX, e.clientY)) return;
    const ch = nearest(mx, my);
    if (!ch) return;
    hl = ch.i;
    if (frozen) {
      autoHl = ch.i;
      render(FROZEN_NOW, 0);
      return;
    }
    const now = performance.now() / 1000;
    userUntil = now + 3;
    fire(ch, now);
    nextFeat = Math.max(nextFeat, now + FEAT_EVERY);
  };
  const onVis = () => {
    pageVisible = !document.hidden;
    sync();
  };

  hero.addEventListener("pointermove", onMove);
  hero.addEventListener("pointerleave", onLeave);
  hero.addEventListener("click", onClick);
  document.addEventListener("visibilitychange", onVis);

  let rt = 0;
  const relayout = () => {
    const r = hero.getBoundingClientRect();
    const next = `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(anchor.getBoundingClientRect().bottom - r.top)}`;
    if (next === sig) return;
    sig = next;
    layout();
    if (frozen) freeze();
  };
  const ro = new ResizeObserver(() => {
    if (!booted) return;
    window.clearTimeout(rt);
    rt = window.setTimeout(relayout, 120);
  });
  ro.observe(hero);
  ro.observe(anchor);
  const io = new IntersectionObserver((es) => {
    onScreen = es.some((e) => e.isIntersecting);
    sync();
  });
  io.observe(hero);

  // ---------- boot (after the display face, so canvas labels measure right) ----------
  const fonts = document.fonts;
  const fontsReady = Promise.race([
    fonts ? fonts.load(`500 12px "Satoshi"`).then(() => fonts.ready) : Promise.resolve(),
    new Promise((r) => setTimeout(r, 1500)),
  ]).catch(() => undefined);
  fontsReady.then(() => {
    if (dead) return;
    booted = true;
    const r = hero.getBoundingClientRect();
    sig = `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(anchor.getBoundingClientRect().bottom - r.top)}`;
    layout();
    hero.classList.add("lf-live");
    if (RM) {
      freeze();
      return;
    }
    ist = performance.now() / 1000;
    t0 = ist - 6; // positions are periodic in t, so the field is populated from frame one
    nextFeat = ist + 1.1;
    sync();
  });

  return {
    destroy() {
      dead = true;
      running = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(rt);
      ro.disconnect();
      io.disconnect();
      hero.removeEventListener("pointermove", onMove);
      hero.removeEventListener("pointerleave", onLeave);
      hero.removeEventListener("click", onClick);
      document.removeEventListener("visibilitychange", onVis);
    },
    drop(armId, from, to) {
      if (!booted) return;
      const ch = byId(armId) ?? chains[0];
      if (!ch) return;
      if (frozen) {
        autoHl = ch.i;
        render(FROZEN_NOW, 0);
        return;
      }
      const now = performance.now() / 1000;
      if (from) {
        feats.push({ ch, t0: now, T: ch.gr.T, from, to: to ?? "→ lfUSDC" });
        autoHl = ch.i;
      } else fire(ch, now);
      nextFeat = Math.max(nextFeat, now + FEAT_EVERY);
    },
    setWeights(k, j) {
      if (!(k >= 0 && j >= 0 && k + j > 0)) return;
      weights = { k, j };
      if (!booted) return;
      buildStreams();
      if (frozen) render(FROZEN_NOW, 0);
    },
  };
}
