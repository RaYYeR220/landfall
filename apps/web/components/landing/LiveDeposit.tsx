"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Route = "connect" | "address";
type FireOk = { route: Route; owner: string; txHash: string; amount?: string };
type Landing = { signature?: string; shares?: number };
type LandedEvent = { kind: string; signature: string; time: number | null; shares?: number };

type Run =
  | { phase: "idle" }
  | { phase: "firing"; route: Route; startedAt: number }
  | { phase: "bridging"; route: Route; startedAt: number; fire: FireOk }
  | { phase: "landed"; route: Route; startedAt: number; fire: FireOk; landing: Landing; doneAt: number }
  | { phase: "timeout"; route: Route; startedAt: number; fire: FireOk }
  | { phase: "error"; route: Route; startedAt: number; message: string };

const WATCH_MS = 4 * 60_000;
const POLL_MS = 5_000;

const Ctx = createContext<{ open: () => void }>({ open: () => {} });
export const useLiveDeposit = () => useContext(Ctx);

const short = (s: string) => (s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const usdc = (base?: string) => {
  const n = Number(base);
  return Number.isFinite(n) && n > 0 ? n / 1e6 : 1;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res) => {
    const t = setTimeout(res, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), res()), { once: true });
  });

async function getPosition(owner: string, signal: AbortSignal) {
  try {
    const r = await fetch(`/api/position?owner=${encodeURIComponent(owner)}&history=1`, { cache: "no-store", signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { shares?: unknown; history?: unknown };
    return {
      shares: typeof j.shares === "number" ? j.shares : null,
      landed: (Array.isArray(j.history) ? (j.history as LandedEvent[]) : []).filter((e) => e && e.kind === "landed" && typeof e.signature === "string"),
    };
  } catch {
    return null;
  }
}

type StepState = "wait" | "run" | "done" | "fail";

function Step({ state, title, children }: { state: StepState; title: string; children?: ReactNode }) {
  return (
    <li className={`lf-step lf-step-${state}`}>
      <span className="lf-step-dot" aria-hidden="true" />
      <div>
        <p className="lf-step-t">
          {title}
          <span className="lf-sr"> ({state === "done" ? "done" : state === "run" ? "in progress" : state === "fail" ? "did not run" : "waiting"})</span>
        </p>
        {children ? <div className="lf-step-m">{children}</div> : null}
      </div>
    </li>
  );
}

export function LiveDepositProvider({ children }: { children: ReactNode }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const [run, setRun] = useState<Run>({ phase: "idle" });
  const [now, setNow] = useState(0);

  const open = useCallback(() => {
    const d = dlg.current;
    if (d && !d.open) d.showModal();
  }, []);
  const close = () => dlg.current?.close();

  useEffect(() => () => ctrlRef.current?.abort(), []);

  const busy = run.phase === "firing" || run.phase === "bridging";
  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [busy]);

  const watch = async (fire: FireOk, route: Route, startedAt: number, signal: AbortSignal) => {
    const base = await getPosition(fire.owner, signal);
    const seen = new Set(base?.landed.map((e) => e.signature) ?? []);
    const until = Date.now() + WATCH_MS;
    while (Date.now() < until) {
      await sleep(POLL_MS, signal);
      if (signal.aborted) return;
      const p = await getPosition(fire.owner, signal);
      if (signal.aborted) return;
      if (!p) continue;
      const ev = p.landed.find((e) => (e.time !== null && e.time * 1000 >= startedAt - 2000) || (base !== null && !seen.has(e.signature)));
      const grew = base?.shares != null && p.shares != null && p.shares > base.shares + 1e-9 ? p.shares - base.shares : null;
      if (ev || grew !== null) {
        setRun({ phase: "landed", route, startedAt, fire, doneAt: Date.now(), landing: { signature: ev?.signature, shares: ev?.shares ?? grew ?? undefined } });
        return;
      }
    }
    setRun({ phase: "timeout", route, startedAt, fire });
  };

  const fire = async (route: Route) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const startedAt = Date.now();
    setRun({ phase: "firing", route, startedAt });
    let status = 0;
    let body: (Partial<FireOk> & { error?: unknown }) | null = null;
    try {
      const res = await fetch("/api/demo/fire", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ route }),
        signal: ctrl.signal,
      });
      status = res.status;
      body = await res.json().catch(() => null);
      if (!res.ok || !body || typeof body.error === "string" || !body.owner || !body.txHash) {
        const message = typeof body?.error === "string" ? body.error : `the server answered ${status || "with an error"}`;
        setRun({ phase: "error", route, startedAt, message });
        return;
      }
    } catch {
      if (ctrl.signal.aborted) return;
      setRun({ phase: "error", route, startedAt, message: "the request did not reach the server, check your connection and try again" });
      return;
    }
    const ok: FireOk = { route, owner: String(body.owner), txHash: String(body.txHash), amount: body.amount };
    setRun({ phase: "bridging", route, startedAt, fire: ok });
    window.dispatchEvent(new CustomEvent("landfall:drop", { detail: { arm: "base", from: `${usdc(ok.amount)} USDC · Base`, to: "→ lfUSDC" } }));
    void watch(ok, route, startedAt, ctrl.signal);
  };

  // ---------- step states ----------
  const ph = run.phase;
  const fired = ph === "bridging" || ph === "landed" || ph === "timeout";
  const f = fired ? (run as { fire: FireOk }).fire : null;
  const route: Route = ph === "idle" ? "connect" : run.route;
  const s1: StepState = ph === "firing" ? "run" : fired ? "done" : ph === "error" ? "fail" : "wait";
  const s2: StepState = fired ? "done" : "wait";
  const s3: StepState = ph === "bridging" || ph === "timeout" ? "run" : ph === "landed" ? "done" : "wait";
  const s4: StepState = ph === "landed" ? "done" : "wait";
  const startedAt = ph === "idle" ? 0 : run.startedAt;
  const elapsed = ph === "landed" ? run.doneAt - startedAt : now - startedAt;

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <dialog
        ref={dlg}
        className="lf-drawer"
        aria-labelledby="lf-drawer-title"
        onClick={(e) => {
          if (e.target === dlg.current) close();
        }}
      >
        <div className="lf-drawer-in">
          <div className="lf-drawer-top">
            <span className="lf-drawer-kicker">
              <i aria-hidden="true" />
              Solana mainnet
            </span>
            <button type="button" className="lf-x" onClick={close} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <h2 id="lf-drawer-title" className="lf-drawer-h">Fire a live deposit</h2>
          <p className="lf-drawer-lede">A spend-capped demo wallet on Base sends 1 USDC through Intents Connect. Watch it land.</p>

          <div className="lf-drawer-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => fire("connect")}>
              {busy ? "Running…" : ph === "idle" ? "Fire" : "Fire again"}
            </button>
            <button type="button" className="lf-textbtn" disabled={busy} onClick={() => fire("address")}>
              Send to the permanent address instead
            </button>
          </div>

          <ol className="lf-steps" aria-live="polite">
            <Step state={s1} title={route === "address" ? "Sent on Base, no signature" : "Signed on Base"}>
              {route === "address" ? "A plain USDC transfer to the demo’s permanent EVM address." : "One Intents Connect signature from the demo wallet."}
            </Step>
            <Step state={s2} title="Deposit sent">
              {f ? (
                <a className="lf-tx" href={`https://basescan.org/tx/${f.txHash}`} target="_blank" rel="noreferrer">
                  {short(f.txHash)} on Basescan ↗
                </a>
              ) : (
                "1 USDC on Base."
              )}
            </Step>
            <Step state={s3} title="Bridging via Aurora Intents">
              {ph === "bridging" ? `Watching the demo position · ${clock(elapsed)}` : ph === "landed" ? `Arrived in ${clock(elapsed)}` : ph === "timeout" ? "Still on its way." : "Swapped to USDC and paid out on Solana."}
            </Step>
            <Step state={s4} title="Landed on Solana">
              {ph === "landed" ? (
                <>
                  {run.landing.shares ? `+${run.landing.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} lfUSDC shares · ` : "Vault shares minted · "}
                  <a
                    className="lf-tx"
                    href={run.landing.signature ? `https://solscan.io/tx/${run.landing.signature}` : `https://solscan.io/account/${run.fire.owner}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {run.landing.signature ? `${short(run.landing.signature)} on Solscan ↗` : "position on Solscan ↗"}
                  </a>
                </>
              ) : (
                "As lfUSDC vault shares."
              )}
            </Step>
          </ol>

          {ph === "firing" ? <p className="lf-note">Signing and sending on Base · {clock(elapsed)}. This takes a few seconds.</p> : null}
          {ph === "error" ? (
            <p className="lf-note lf-note-err" role="status">
              <span>Not fired:</span> {run.message}
            </p>
          ) : null}
          {ph === "timeout" ? (
            <p className="lf-note" role="status">
              Not landed after 4 minutes. Bridges sometimes run long; it lands on its own.{" "}
              <a className="lf-tx" href={`https://solscan.io/account/${run.fire.owner}`} target="_blank" rel="noreferrer">
                Watch the position ↗
              </a>
            </p>
          ) : null}
          {f ? (
            <p className="lf-drawer-owner">
              Demo position{" "}
              <a className="lf-tx mono" href={`https://solscan.io/account/${f.owner}`} target="_blank" rel="noreferrer">
                {short(f.owner)} ↗
              </a>
            </p>
          ) : null}

          <p className="lf-drawer-fine">
            Every step is a real mainnet transaction. The demo wallet only holds a small daily budget, and what it sends lands in the demo’s own vault position.
          </p>
        </div>
      </dialog>
    </Ctx.Provider>
  );
}
