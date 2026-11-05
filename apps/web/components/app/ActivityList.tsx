"use client";

import { type Activity, solscanTx, usd } from "./api";

type Row = { key: string; at: number; title: string; detail: string; href?: string; tone: "ok" | "info" | "warn" | "bad" };

const ts = (s?: string | number | null) => (typeof s === "number" ? s * 1000 : s ? Date.parse(s) : 0);

export default function ActivityList({ activity }: { activity?: Activity }) {
  if (!activity) return null;
  const rows: Row[] = [];
  for (const e of activity.chain) {
    if (e.kind === "landed")
      rows.push({
        key: e.signature + "l",
        at: ts(e.time),
        title: `Landed ${usd(e.amount)} → ${e.shares.toLocaleString("en-US", { maximumFractionDigits: 6 })} lfUSDC`,
        detail: e.source === "inbox" ? "Persistent-address deposit, swept from your inbox" : "Deposited from your wallet",
        href: solscanTx(e.signature),
        tone: "ok",
      });
    else
      rows.push({ key: e.signature + "r", at: ts(e.time), title: `Withdrew ${usd(e.amount)}`, detail: `${e.shares.toLocaleString("en-US", { maximumFractionDigits: 6 })} lfUSDC redeemed`, href: solscanTx(e.signature), tone: "info" });
  }
  for (const d of activity.deposits) {
    const amount = d.decimals != null ? Number(d.amount) / 10 ** d.decimals : Number(d.amount);
    rows.push({
      key: `${d.tx}-${d.status}`,
      at: ts(d.at),
      title: d.status === "received" ? `Received on ${d.chain.toUpperCase()}` : d.status === "success" ? "Paid out to your inbox on Solana" : "Payout failed",
      detail: `${amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${d.asset?.split(/[:.-]/).pop()?.toUpperCase() ?? ""} · ${d.tx.slice(0, 14)}…`,
      tone: d.status === "failed" ? "bad" : d.status === "success" ? "ok" : "info",
    });
  }
  for (const x of activity.executions) {
    rows.push({
      key: x.id ?? Math.random().toString(),
      at: ts(x.createdAt),
      title: `${x.metadata?.title ?? "Intents Connect execution"} · ${x.status ?? ""}`,
      detail: x.quote?.depositAddress ? `deposit address ${x.quote.depositAddress.slice(0, 12)}…` : "",
      tone: x.status === "SUCCESS" ? "ok" : x.status?.includes("FAILED") ? "bad" : x.status === "EXPIRED" ? "warn" : "info",
    });
  }
  rows.sort((a, b) => b.at - a.at);

  return (
    <section className="card p-6 md:p-8">
      <p className="eyebrow">Activity</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-ink-3">No deposits yet. Send to any of your addresses — it shows up here within a minute or two.</p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {rows.slice(0, 30).map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className={r.tone === "ok" ? "text-ink" : r.tone === "bad" ? "text-bad" : r.tone === "warn" ? "text-warn" : "text-ink-2"}>{r.title}</p>
                <p className="mono truncate text-xs text-ink-4">{r.detail}</p>
              </div>
              <div className="shrink-0 text-right text-xs text-ink-4">
                {r.at ? new Date(r.at).toLocaleString() : ""}
                {r.href && (
                  <a className="ml-2 underline decoration-[var(--line-2)] underline-offset-4 hover:text-ink" href={r.href} target="_blank" rel="noreferrer">
                    view
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
