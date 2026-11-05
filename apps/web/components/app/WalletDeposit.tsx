"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EVM_CHAIN_IDS, type ExecutionPlan, type ExecutionPreview, type SupportedToken } from "@aurora-is-near/intents-connect";
import { useExecution } from "@aurora-is-near/intents-connect/react";
import { AURORA_ASSETS, landfallDepositRecipe, vaultAddresses } from "@landfall/sdk";
import { type Identity, usd } from "./api";
import { useLandfallWallet } from "./Providers";

const vault = vaultAddresses();
const recipe = landfallDepositRecipe(vault);

const EVM = new Set(["eth", "base", "arb", "op", "pol", "bsc", "avax", "gnosis", "scroll", "monad", "bera", "xlayer", "plasma"]);
const CHAIN_LABEL: Record<string, string> = { eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", pol: "Polygon", bsc: "BNB Chain", avax: "Avalanche", gnosis: "Gnosis", scroll: "Scroll", monad: "Monad", bera: "Berachain", xlayer: "X Layer", plasma: "Plasma", sol: "Solana" };

const PHASES: { id: string; label: string }[] = [
  { id: "planning", label: "Quote" },
  { id: "awaiting-signature", label: "Sign" },
  { id: "awaiting-deposit", label: "Deposit" },
  { id: "settling", label: "Bridge + land" },
  { id: "success", label: "In the vault" },
];

const toAtomic = (v: string, decimals: number) => {
  const [i, f = ""] = v.trim().split(".");
  if (!/^\d+$/.test(i || "0") || !/^\d*$/.test(f)) return null;
  return (BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
};

export default function WalletDeposit({ identity }: { identity: Identity }) {
  const { api, wallet } = useLandfallWallet();
  const qc = useQueryClient();
  const exec = useExecution({});
  const [amount, setAmount] = useState("1");
  const [tokenId, setTokenId] = useState<string>();
  const [preview, setPreview] = useState<ExecutionPreview<void>>();
  const [error, setError] = useState<string>();

  const tokens = useQuery({
    queryKey: ["ic-tokens"],
    queryFn: () => api.listSupportedTokens("inOperation"),
    staleTime: 5 * 60_000,
  });
  const usable = useMemo(() => {
    const family = wallet.family;
    return (tokens.data?.in ?? []).filter((t) => t.blockchain && (family === "sol" ? t.blockchain === "sol" : EVM.has(t.blockchain)) && t.assetId && t.decimals !== undefined);
  }, [tokens.data, wallet.family]);
  const token: SupportedToken | undefined = usable.find((t) => t.assetId === tokenId) ?? usable.find((t) => t.symbol === "USDC") ?? usable[0];

  const plan = (): ExecutionPlan<void> | null => {
    if (!token?.assetId || token.decimals === undefined) return null;
    const atomic = toAtomic(amount, token.decimals);
    if (!atomic || atomic === "0") return null;
    return {
      recipe,
      params: undefined,
      feeStrategy: { kind: "threeRound", amountReserveBps: 0 },
      quote: { originAsset: token.assetId, destinationAsset: AURORA_ASSETS.solanaUsdc, amount: atomic, swapType: "EXACT_INPUT", slippageTolerance: 100 },
      originChain: token.blockchain!,
      originToken: { contractAddress: token.contractAddress, decimals: token.decimals },
      originChainId: EVM_CHAIN_IDS[token.blockchain as keyof typeof EVM_CHAIN_IDS] ?? null,
      depositViaWallet: true,
    };
  };

  const doPreview = async () => {
    setError(undefined);
    const p = plan();
    if (!p) return setError("Enter an amount");
    try {
      setPreview(await exec.preview(p));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doRun = async () => {
    if (!preview) return;
    setError(undefined);
    try {
      await exec.run(preview.plan);
      qc.invalidateQueries({ queryKey: ["position", identity.owner] });
      qc.invalidateQueries({ queryKey: ["activity"] });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const activeIdx = PHASES.findIndex((p) => p.id === exec.phase);
  const done = exec.phase === "success";

  return (
    <section className="card p-6 md:p-8">
      <p className="eyebrow">From this wallet · one signature</p>
      <h2 className="mt-2 text-2xl font-medium tracking-tight">Deposit and land in one flow</h2>
      <p className="mt-2 max-w-xl text-[15px] text-ink-2">
        Intents Connect bridges what you send to USDC on Solana and, in the same transaction, your Solana account deposits it into the vault. No bridge UI, no SOL needed.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm text-ink-3">
          Send
          <select
            className="h-11 min-w-56 rounded-pill border border-line-2 bg-bg-3 px-4 text-ink"
            value={token?.assetId ?? ""}
            onChange={(e) => {
              setTokenId(e.target.value);
              setPreview(undefined);
            }}
            disabled={exec.isBusy || !usable.length}
          >
            {usable.map((t) => (
              <option key={t.assetId} value={t.assetId}>
                {t.symbol} · {CHAIN_LABEL[t.blockchain!] ?? t.blockchain}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-ink-3">
          Amount
          <input
            className="mono h-11 w-40 rounded-pill border border-line-2 bg-bg-3 px-4 text-ink"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setPreview(undefined);
            }}
            disabled={exec.isBusy}
          />
        </label>
        {!preview ? (
          <button className="btn btn-ghost" onClick={doPreview} disabled={exec.isBusy || !token}>
            Get quote
          </button>
        ) : (
          <button className="btn btn-primary" onClick={doRun} disabled={exec.isBusy || done}>
            Deposit {amount} {token?.symbol}
          </button>
        )}
      </div>

      {preview && (
        <dl className="mt-5 grid max-w-xl grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-ink-3">Lands in the vault</dt>
          <dd className="mono text-right">{usd(Number(preview.spendable ?? 0) / 1e6)} USDC</dd>
          <dt className="text-ink-3">Solana network fee</dt>
          <dd className="mono text-right">{usd(Number(preview.execution.details.networkFee ?? 0) / 1e6)}</dd>
          <dt className="text-ink-3">Gas on Solana</dt>
          <dd className="text-right">paid by Intents Connect</dd>
        </dl>
      )}

      {(exec.isBusy || done || exec.phase === "failed" || exec.phase === "expired") && (
        <ol className="mt-6 flex flex-wrap gap-2 text-sm" aria-label="Progress">
          {PHASES.map((p, i) => (
            <li key={p.id} className={`rounded-pill border px-3 py-1 ${i < activeIdx || done ? "border-ok/50 text-ok" : i === activeIdx ? "border-acc text-acc" : "border-line text-ink-4"}`}>
              {p.label}
            </li>
          ))}
        </ol>
      )}
      {exec.depositAddress && !done && (
        <p className="mt-3 text-sm text-ink-3">
          Deposit address <code className="mono text-ink">{exec.depositAddress}</code>
          {exec.depositTxHash ? ` · tx ${exec.depositTxHash.slice(0, 10)}…` : ""}
        </p>
      )}
      {exec.phase === "expired" && <p className="mt-3 text-sm text-warn">The deposit window passed. If your transfer is on its way it still lands — the execution revives when it arrives.</p>}
      {exec.phase === "failed" && <p className="mt-3 text-sm text-warn">The landing step did not run. Your USDC is safe in your Solana account — finish it from the recovery centre.</p>}
      {exec.recovery?.kind === "retry-transfer" && (
        <button className="btn btn-ghost mt-3" onClick={() => exec.retryDeposit()}>
          Retry the transfer
        </button>
      )}
      {exec.recovery?.kind === "resume-or-cancel" && (
        <div className="mt-3 flex gap-2">
          <button className="btn btn-ghost" onClick={() => exec.resume(exec.recovery!.kind === "resume-or-cancel" ? exec.recovery!.executionId : "")}>
            Resume the open execution
          </button>
          <button className="btn btn-ghost" onClick={() => exec.cancel()}>
            Cancel it
          </button>
        </div>
      )}
      {(error || exec.error) && <p className="mt-3 text-sm text-bad">{error ?? exec.error?.message}</p>}
    </section>
  );
}
