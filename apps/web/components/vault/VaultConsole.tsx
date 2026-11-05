"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import landing from "../../../../eval/results/landing.json";
import SiteHeader from "../SiteHeader";
import { getJson, short, solscanAccount, usd, type VaultHealth, type VaultSummary } from "../app/api";

const adverse = landing.results.filter((r) => r.id !== "healthy");

const usePoll = <T,>(url: string, ms: number) => {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    const tick = () =>
      getJson<T>(url)
        .then((d) => live && (setData(d), setError(undefined)))
        .catch((e: Error) => live && setError(e.message));
    tick();
    const id = setInterval(tick, ms);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [url, ms]);
  return { data, error };
};

const pct = (x: number, total: number) => (total > 0 ? (x / total) * 100 : 0);
const ago = (t: number | null) => {
  if (!t) return "never";
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

const Check = ({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) => (
  <li className="flex items-baseline justify-between gap-4 py-2">
    <span className="flex items-center gap-2.5">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok === null ? "bg-ink-4" : ok ? "bg-ok" : "bg-warn"}`} />
      <span className={ok === false ? "text-warn" : "text-ink-2"}>{label}</span>
    </span>
    {detail && <span className="mono text-xs text-ink-3">{detail}</span>}
  </li>
);

/** Live condition behind each adverse scenario, where one exists on chain. */
const liveFor = (id: string, h?: VaultHealth): boolean | null => {
  if (!h) return null;
  if (id === "deposit_limit_reached") return h.kamino.readable ? h.kamino.headroom <= 0 : null;
  if (id === "market_emergency_mode") return h.kamino.readable ? h.kamino.emergencyMode : null;
  if (id === "reserve_not_active") return h.kamino.readable ? !h.kamino.active : null;
  if (id === "reserve_layout_changed") return !h.kamino.readable;
  return null;
};

const Allocation = ({ v }: { v: VaultSummary }) => {
  const total = v.nav.total;
  const rows = [
    { key: "idle", label: "Idle buffer", value: v.nav.idle, target: v.weights.idleBuffer, color: "var(--ink-3)" },
    { key: "kamino", label: "Kamino", value: v.nav.kamino, target: v.weights.kamino, color: "var(--acc)" },
    { key: "jl", label: "Jupiter Lend", value: v.nav.jupiterLend, target: v.weights.jupiterLend, color: "var(--ok)" },
  ];
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-pill bg-bg-3" role="img" aria-label="Current allocation">
        {rows.map((r) => (
          <div key={r.key} style={{ width: `${pct(r.value, total)}%`, background: r.color }} className="h-full transition-[width] duration-700" />
        ))}
      </div>
      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
        {rows.map((r) => (
          <li key={r.key} className="flex items-baseline justify-between gap-3 sm:block">
            <span className="flex items-center gap-2 text-ink-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />
              {r.label}
            </span>
            <span className="mono text-ink sm:mt-1 sm:block">
              {usd(r.value)} <span className="text-ink-4">· {pct(r.value, total).toFixed(1)}% now / {r.target}% target</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default function VaultConsole() {
  const vault = usePoll<VaultSummary>("/api/vault", 20_000);
  const health = usePoll<VaultHealth>("/api/vault/health", 20_000);
  const v = vault.data;
  const h = health.data;

  return (
    <div className="min-h-screen">
      <SiteHeader current="vault">
        <Link href="/app" className="btn btn-primary h-10">
          Open app
        </Link>
      </SiteHeader>

      <main className="wrap grid gap-6 pb-24 pt-6">
        <section className="card p-6 md:p-8">
          <p className="eyebrow">Landfall USDC vault · Solana</p>
          {!v && vault.error && <p className="mt-4 text-bad">{vault.error}</p>}
          {!v && !vault.error && <p className="mt-4 text-ink-3">Reading the vault…</p>}
          {v && (
            <>
              <div className="mt-3 grid gap-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
                <div>
                  <p className="text-sm text-ink-3">Net asset value</p>
                  <p className="mt-1 text-[clamp(36px,5vw,56px)] font-medium leading-none tracking-[-0.04em]">{usd(v.nav.total)}</p>
                </div>
                <div>
                  <p className="text-sm text-ink-3">Share price</p>
                  <p className="mono mt-2 text-xl">{v.sharePrice.toFixed(6)}</p>
                  <p className="text-xs text-ink-4">USDC per lfUSDC</p>
                </div>
                <div>
                  <p className="text-sm text-ink-3">Earning</p>
                  <p className="mono mt-2 text-xl">{(v.apy.blended * 100).toFixed(2)}%</p>
                  <p className="text-xs text-ink-4">blended supply APY</p>
                </div>
                <div>
                  <p className="text-sm text-ink-3">Landed</p>
                  <p className="mono mt-2 text-xl">{usd(v.landed.total)}</p>
                  <p className="text-xs text-ink-4">
                    {v.landed.count} deposits · {usd(v.redeemed)} withdrawn
                  </p>
                </div>
              </div>
              <div className="mt-8">
                <Allocation v={v} />
              </div>
              {v.paused && <p className="mt-4 text-sm text-warn">Allocation is paused by the curator. Deposits still land in the idle buffer and withdrawals stay open.</p>}
            </>
          )}
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="card p-6 md:p-8">
            <div className="flex items-baseline justify-between">
              <p className="eyebrow">Kamino · USDC, Main market</p>
              {v && <span className="mono text-sm text-ink-2">{(v.apy.kamino * 100).toFixed(2)}% APY</span>}
            </div>
            {v && (
              <p className="mt-3 text-sm text-ink-3">
                {usd(v.nav.kamino)} allocated · cap {usd(v.caps.kamino, 0)} · weight {v.weights.kamino}%
                {!v.strategies.kamino.enabled && <span className="text-warn"> · switched off</span>}
              </p>
            )}
            <ul className="mt-4 divide-y divide-[var(--line)] text-sm">
              <Check ok={h ? h.kamino.readable : null} label="Reserve readable" detail={h && !h.kamino.readable ? "layout changed" : undefined} />
              <Check ok={h ? h.kamino.active : null} label="Reserve active" />
              <Check ok={h ? !h.kamino.emergencyMode : null} label="Market not in emergency mode" />
              <Check
                ok={h ? h.kamino.headroom > 0 : null}
                label="Room under the deposit limit"
                detail={h?.kamino.readable ? `${usd(h.kamino.headroom, 0)} of ${usd(h.kamino.depositLimit, 0)}` : undefined}
              />
            </ul>
          </div>
          <div className="card p-6 md:p-8">
            <div className="flex items-baseline justify-between">
              <p className="eyebrow">Jupiter Lend · USDC Earn</p>
              {v && <span className="mono text-sm text-ink-2">{(v.apy.jupiterLend * 100).toFixed(2)}% APY</span>}
            </div>
            {v && (
              <p className="mt-3 text-sm text-ink-3">
                {usd(v.nav.jupiterLend)} allocated · cap {usd(v.caps.jupiterLend, 0)} · weight {v.weights.jupiterLend}%
                {!v.strategies.jupiterLend.enabled && <span className="text-warn"> · switched off</span>}
              </p>
            )}
            <ul className="mt-4 divide-y divide-[var(--line)] text-sm">
              <Check ok={h ? h.jupiterLend.readable : null} label="Lending pool readable" />
              <Check ok={h ? h.jupiterLend.exchangePrice > 0 : null} label="Exchange price" detail={h?.jupiterLend.readable ? h.jupiterLend.exchangePrice.toFixed(6) : undefined} />
            </ul>
            <p className="mt-4 text-xs text-ink-4">Both strategies are valued from their own on-chain accounts in every deposit and withdrawal; nothing is priced off-chain.</p>
          </div>
        </section>

        <section className="card p-6 md:p-8">
          <p className="eyebrow">Landing guarantee</p>
          <h2 className="mt-2 max-w-3xl text-2xl font-medium tracking-tight">
            A deposit that reaches Solana always lands: {adverse.filter((r) => r.landfall.landed).length} of {adverse.length} adverse conditions. A direct bridge-and-deposit lands in {adverse.filter((r) => r.docs_recipe.landed).length} and strands the funds in the other {adverse.filter((r) => !r.docs_recipe.landed).length}.
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-ink-3">
            Landing mints shares against the idle buffer and touches no lending protocol. Allocation into Kamino and Jupiter Lend is a separate permissionless step that simply waits while a strategy can&apos;t take deposits. Each row replays the same {usd(landing.bridged_usdc / 1e6, 0)} bridged landing on a mainnet snapshot with one condition switched on.
          </p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-ink-4">
                <tr className="border-b border-line">
                  <th className="py-2 pr-4 font-normal">Condition</th>
                  <th className="py-2 pr-4 font-normal">Direct deposit into Kamino</th>
                  <th className="py-2 pr-4 font-normal">Landfall</th>
                  <th className="py-2 font-normal">Right now</th>
                </tr>
              </thead>
              <tbody>
                {landing.results.map((r) => {
                  const live = liveFor(r.id, h);
                  return (
                    <tr key={r.id} className="border-b border-line align-top">
                      <td className="py-3 pr-4 text-ink-2">{r.scenario}</td>
                      <td className="py-3 pr-4">
                        {r.docs_recipe.landed ? (
                          <span className="text-ink-2">lands</span>
                        ) : (
                          <span className="text-bad">reverts · {usd(r.docs_recipe.usdc_left_in_intermediary / 1e6, 0)} stuck</span>
                        )}
                      </td>
                      <td className="py-3 pr-4">{r.landfall.landed ? <span className="text-ok">lands</span> : <span className="text-bad">reverts</span>}</td>
                      <td className="py-3 text-ink-3">{live === null ? "—" : live ? <span className="text-warn">happening</span> : "not happening"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="card p-6 md:p-8 text-sm">
            <p className="eyebrow">Inboxes and keeper</p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
              <dt className="text-ink-3">Inboxes</dt>
              <dd className="mono text-right">{h?.queue ? h.queue.inboxes : "—"}</dd>
              <dt className="text-ink-3">Waiting to land</dt>
              <dd className="mono text-right">{h?.queue ? `${h.queue.waiting} · ${usd(h.queue.waitingUsdc)}` : "—"}</dd>
              <dt className="text-ink-3">Keeper last active</dt>
              <dd className="mono text-right">{h?.keeper ? ago(h.keeper.lastActivity) : "—"}</dd>
              <dt className="text-ink-3">Keeper balance</dt>
              <dd className="mono text-right">{h?.keeper ? `${h.keeper.sol.toFixed(4)} SOL` : "—"}</dd>
            </dl>
            <p className="mt-4 text-xs text-ink-4">Sweeping an inbox and allocating idle USDC are permissionless. Anyone can run the keeper; it can only move funds along the paths the program allows.</p>
          </div>
          <div className="card p-6 md:p-8 text-sm">
            <p className="eyebrow">Curator</p>
            {v && (
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                <dt className="text-ink-3">Curator</dt>
                <dd className="mono truncate text-right">
                  <a href={solscanAccount(v.curator)} target="_blank" rel="noreferrer" className="hover:text-acc">
                    {short(v.curator, 6, 6)}
                  </a>
                </dd>
                <dt className="text-ink-3">Idle buffer</dt>
                <dd className="mono text-right">{v.weights.idleBuffer}%</dd>
                <dt className="text-ink-3">Sweep fee</dt>
                <dd className="mono text-right">{usd(v.params.sweepFee, 4)} (max 1%)</dd>
                <dt className="text-ink-3">Minimum sweep</dt>
                <dd className="mono text-right">{usd(v.params.minSweep)}</dd>
                <dt className="text-ink-3">Program</dt>
                <dd className="mono truncate text-right">
                  <a href={solscanAccount(v.programId)} target="_blank" rel="noreferrer" className="hover:text-acc">
                    {short(v.programId, 6, 6)}
                  </a>
                </dd>
                <dt className="text-ink-3">Vault</dt>
                <dd className="mono truncate text-right">
                  <a href={solscanAccount(v.vault)} target="_blank" rel="noreferrer" className="hover:text-acc">
                    {short(v.vault, 6, 6)}
                  </a>
                </dd>
                <dt className="text-ink-3">Share token</dt>
                <dd className="mono truncate text-right">
                  <a href={solscanAccount(v.shareMint)} target="_blank" rel="noreferrer" className="hover:text-acc">
                    {short(v.shareMint, 6, 6)}
                  </a>
                </dd>
              </dl>
            )}
            <p className="mt-4 text-xs text-ink-4">The curator sets weights, caps and the sweep fee (never above 1%) and can pause allocation. It can't move user funds, can't raise the minimum sweep above 5 USDC, and withdrawals never depend on it.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
