"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { signIntentsConnectPayload, type SolanaRecipe } from "@aurora-is-near/intents-connect";
import { useExecution } from "@aurora-is-near/intents-connect/react";
import {
  ata,
  AURORA_ASSETS,
  createAtaIdempotentIx,
  redeemIxs,
  redeemSourceFor,
  USDC_MINT,
  vaultAddresses,
  withdrawAnywhereSteps,
  withdrawToSolanaSteps,
  type Nav,
} from "@landfall/sdk";
import { type Identity, type Position, type VaultSummary, usd } from "./api";
import { useLandfallWallet } from "./Providers";

const vault = vaultAddresses();
const BASE_USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

const navOf = (v: VaultSummary): Nav =>
  ({ idle: BigInt(Math.floor(v.nav.idle * 1e6)), kamino: BigInt(Math.floor(v.nav.kamino * 1e6)), jupiterLend: BigInt(Math.floor(v.nav.jupiterLend * 1e6)) }) as Nav;

export default function Withdraw({ identity, position, vaultInfo }: { identity: Identity; position?: Position; vaultInfo?: VaultSummary }) {
  const { api, wallet } = useLandfallWallet();
  const qc = useQueryClient();
  const exec = useExecution({});
  const [pct, setPct] = useState(100);
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  if (!position || position.shares <= 0) {
    return (
      <section className="card p-6 md:p-8">
        <p className="eyebrow">Withdraw</p>
        <p className="mt-3 text-ink-3">Nothing to withdraw yet.</p>
      </section>
    );
  }

  const shares = BigInt(Math.floor(position.shares * 1e6 * (pct / 100)));
  const assets = BigInt(Math.floor(position.value * 1e6 * (pct / 100)));
  const minOut = (assets * 995n) / 1000n;
  const source = vaultInfo ? redeemSourceFor(navOf(vaultInfo), assets) : "idle";
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["position", identity.owner] });
    qc.invalidateQueries({ queryKey: ["vault"] });
  };

  /** A Solana wallet owns its shares directly: one transaction, signed in the wallet. */
  const withdrawDirect = async () => {
    const sol = wallet.wallet?.getProviders().sol as unknown as { signTransaction: (t: Transaction) => Promise<Transaction> } | undefined;
    if (!sol) throw new Error("connect your Solana wallet");
    const owner = new PublicKey(identity.owner);
    const conn = new Connection(`${window.location.origin}/api/solana-rpc`, "confirmed");
    const tx = new Transaction().add(createAtaIdempotentIx(owner, owner, USDC_MINT), ...redeemIxs(vault, owner, ata(owner, USDC_MINT), shares, minOut, source));
    tx.feePayer = owner;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    const signed = await sol.signTransaction(tx);
    const sig = await conn.sendRawTransaction(signed.serialize());
    setStatus(`Sent · ${sig.slice(0, 12)}…`);
    await conn.confirmTransaction(sig, "confirmed");
    setStatus("Withdrawn to your wallet");
  };

  /** An EVM wallet's shares sit in its Intents Connect Solana account: steps-only to any Solana address. */
  const withdrawToSolana = async () => {
    const to = new PublicKey(recipient.trim());
    const recipe: SolanaRecipe<void> = {
      id: "landfall-withdraw-solana",
      intent: "landfall_withdraw_solana",
      title: "Withdraw from Landfall to Solana",
      type: "solana",
      flow: "steps-only",
      destination: { chain: "sol", assetId: AURORA_ASSETS.solanaUsdc, tokenAddress: USDC_MINT.toBase58() },
      buildSteps: ({ intermediary, amount }) => ({
        steps: withdrawToSolanaSteps(vault, new PublicKey(intermediary), to, shares, minOut, source, BigInt(amount)),
      }),
    };
    const p = await exec.previewSteps({ recipe, params: undefined, amount: minOut.toString(), feeFromAmount: { amountReserveBps: 0 } });
    await exec.runSteps(p.plan);
    setStatus(`Withdrawn to ${to.toBase58().slice(0, 6)}…`);
  };

  /** Out-operation: redeem on Solana and bridge the USDC back to the wallet's own chain (Base USDC). */
  const withdrawHome = async () => {
    if (!wallet.wallet) throw new Error("connect your wallet");
    const steps = withdrawAnywhereSteps(vault, new PublicKey(identity.owner), shares, minOut, source);
    const res = await fetch(`/api/intents-connect/api/v1/executions/${identity.wallet}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: "1.0",
        type: "solana",
        outOperation: true,
        quote: { originAsset: AURORA_ASSETS.solanaUsdc, destinationAsset: BASE_USDC, amount: minOut.toString(), swapType: "EXACT_INPUT", slippageTolerance: 100, recipient: identity.wallet },
        steps,
        metadata: { title: "Withdraw from Landfall to Base", intent: "landfall_withdraw_home" },
        dry: false,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error ?? body?.message ?? `create failed (${res.status})`);
    const execution = body.result ?? body;
    setStatus("Sign to withdraw…");
    const env = await signIntentsConnectPayload({
      payload: execution.details.payload,
      standard: wallet.wallet.signingStandard,
      address: identity.wallet,
      providers: wallet.wallet.getProviders(),
    });
    await api.submitSignature(identity.wallet, { ...env, executionId: execution.id });
    setStatus("Withdrawing · USDC is on its way to Base");
  };

  const run = async (fn: () => Promise<void>) => {
    setError(undefined);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="card p-6 md:p-8">
      <p className="eyebrow">Withdraw anywhere</p>
      <h2 className="mt-2 text-2xl font-medium tracking-tight">{usd(Number(assets) / 1e6)} to withdraw</h2>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {[25, 50, 100].map((p) => (
          <button key={p} onClick={() => setPct(p)} className={`rounded-pill border px-3 py-1 text-sm ${pct === p ? "border-ink" : "border-line-2 text-ink-3"}`}>
            {p}%
          </button>
        ))}
        <span className="text-sm text-ink-4">· paid from {source === "idle" ? "the idle buffer" : source === "kamino" ? "Kamino" : "Jupiter Lend"}</span>
      </div>

      {identity.ownsDirectly ? (
        <button className="btn btn-primary mt-5" onClick={() => run(withdrawDirect)}>
          Withdraw to this wallet
        </button>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-field border border-line p-4">
            <p className="text-sm text-ink-2">Back to your wallet on Base (USDC)</p>
            <button className="btn btn-primary mt-3" onClick={() => run(withdrawHome)} disabled={exec.isBusy}>
              Withdraw to Base
            </button>
          </div>
          <div className="rounded-field border border-line p-4">
            <p className="text-sm text-ink-2">To any Solana address</p>
            <input
              className="mono mt-3 h-10 w-full rounded-pill border border-line-2 bg-bg-3 px-4 text-sm"
              placeholder="Solana address"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
            <button className="btn btn-ghost mt-3" onClick={() => run(withdrawToSolana)} disabled={exec.isBusy || !recipient}>
              Withdraw to Solana
            </button>
          </div>
        </div>
      )}
      {status && <p className="mt-3 text-sm text-ok">{status}</p>}
      {exec.isBusy && <p className="mt-3 text-sm text-ink-3">{exec.phase}…</p>}
      {(error || exec.error) && <p className="mt-3 text-sm text-bad">{error ?? exec.error?.message}</p>}
    </section>
  );
}
