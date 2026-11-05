"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import type { SolanaRecipe } from "@aurora-is-near/intents-connect";
import { useExecution } from "@aurora-is-near/intents-connect/react";
import { AURORA_ASSETS, finishIntoVaultSteps, vaultAddresses } from "@landfall/sdk";
import { getJson, type Activity, type Identity, type Position, usd } from "./api";

const vault = vaultAddresses();

/** Steps-only: deposit USDC already sitting in the user's Solana account. */
const finishRecipe: SolanaRecipe<void> = {
  id: "landfall-finish",
  intent: "landfall_finish_into_vault",
  title: "Finish into Landfall vault",
  type: "solana",
  flow: "steps-only",
  destination: { chain: "sol", assetId: AURORA_ASSETS.solanaUsdc, tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  buildSteps: ({ intermediary, amount }) => ({ steps: finishIntoVaultSteps(vault, new PublicKey(intermediary), BigInt(amount)) }),
};

type Item = { id: string; title: string; detail: string; tone: "ok" | "warn" | "bad"; action?: { label: string; run: () => Promise<unknown> } ; link?: { label: string; href: string } };

export default function Recovery({ identity, position, activity }: { identity: Identity; position?: Position; activity?: Activity }) {
  const qc = useQueryClient();
  const exec = useExecution({});
  const [msg, setMsg] = useState<string>();

  const sweep = useMutation({
    mutationFn: () => getJson<{ actions: unknown[] }>("/api/crank", { method: "POST", body: JSON.stringify({ owner: identity.owner }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["position", identity.owner] }),
  });

  const items: Item[] = [];
  if (position && position.inbox.pendingUsdc > 0) {
    items.push({
      id: "inbox",
      title: `${usd(position.inbox.pendingUsdc)} waiting in your inbox`,
      detail: "A persistent-address deposit arrived on Solana and is waiting for the keeper. Sweeping is permissionless — trigger it yourself.",
      tone: "warn",
      action: { label: sweep.isPending ? "Sweeping…" : "Sweep now", run: () => sweep.mutateAsync() },
    });
  }
  if (position && !identity.ownsDirectly && position.looseUsdc > 0.01) {
    items.push({
      id: "loose",
      title: `${usd(position.looseUsdc)} in your Solana account, outside the vault`,
      detail: "Left over from an Intents Connect execution that did not land (or favourable slippage). It is yours — finish it into the vault with one signature.",
      tone: "warn",
      action: {
        label: exec.isBusy ? exec.phase : "Finish into vault",
        run: async () => {
          const atomic = BigInt(Math.floor(position.looseUsdc * 1e6)).toString();
          const p = await exec.previewSteps({ recipe: finishRecipe, params: undefined, amount: atomic, feeFromAmount: { amountReserveBps: 0 } });
          await exec.runSteps(p.plan);
          qc.invalidateQueries({ queryKey: ["position", identity.owner] });
        },
      },
    });
  }
  for (const d of activity?.deposits.filter((x) => x.status === "failed") ?? []) {
    items.push({
      id: `failed-${d.tx}`,
      title: `A ${d.chain.toUpperCase()} deposit failed to pay out`,
      detail: `Aurora retries failed persistent deposits. If it stays failed, open a support case with tx ${d.tx} and address ${d.address}.`,
      tone: "bad",
      link: { label: "Open an Aurora support case", href: "https://aurora.dev/intents-support" },
    });
  }

  return (
    <section className="card p-6 md:p-8">
      <p className="eyebrow">Recovery centre</p>
      <h2 className="mt-2 text-2xl font-medium tracking-tight">Every state has a way out</h2>
      <p className="mt-2 max-w-xl text-[15px] text-ink-2">
        Late deposits revive on their own, landings never revert on lending-market state, and anything that did not make it into the vault stays in an account only your wallet controls.
      </p>
      {items.length === 0 ? (
        <p className="mt-6 flex items-center gap-2 text-sm text-ok">
          <span className="inline-block h-2 w-2 rounded-full bg-ok" /> Nothing is stuck.
        </p>
      ) : (
        <ul className="mt-6 grid gap-3">
          {items.map((it) => (
            <li key={it.id} className="rounded-field border border-line p-4">
              <p className={it.tone === "bad" ? "text-bad" : "text-warn"}>{it.title}</p>
              <p className="mt-1 text-sm text-ink-3">{it.detail}</p>
              {it.action && (
                <button
                  className="btn btn-ghost mt-3"
                  onClick={async () => {
                    setMsg(undefined);
                    try {
                      await it.action!.run();
                    } catch (e) {
                      setMsg((e as Error).message);
                    }
                  }}
                >
                  {it.action.label}
                </button>
              )}
              {it.link && (
                <a className="btn btn-ghost mt-3" href={it.link.href} target="_blank" rel="noreferrer">
                  {it.link.label}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {(msg || exec.error) && <p className="mt-3 text-sm text-bad">{msg ?? exec.error?.message}</p>}
    </section>
  );
}
