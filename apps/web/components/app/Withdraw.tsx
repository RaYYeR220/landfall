"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { signIntentsConnectPayload, type SolanaRecipe } from "@aurora-is-near/intents-connect";
import { useExecution } from "@aurora-is-near/intents-connect/react";
import {
  ata,
  AURORA_ASSETS,
  createAtaIdempotentIx,
  redeemIxs,
  redeemSourceFor,
  swapOutIxs,
  USDC_MINT,
  vaultAddresses,
  WITHDRAW_DESTINATIONS,
  withdrawAnywhereSteps,
  withdrawToSolanaSteps,
  type Nav,
} from "@landfall/sdk";
import { getJson, type Identity, type Position, type VaultSummary, usd } from "./api";
import { useLandfallWallet } from "./Providers";
import { signAndSend, type SolanaSigner } from "./solanaTx";

const vault = vaultAddresses();
const SOLANA = "solana";

type SwapQuote = { depositAddress: string; token: string; amountOutFormatted: string; timeEstimate: number; destination: (typeof WITHDRAW_DESTINATIONS)[number] };

const navOf = (v: VaultSummary): Nav =>
  ({ idle: BigInt(Math.floor(v.nav.idle * 1e6)), kamino: BigInt(Math.floor(v.nav.kamino * 1e6)), jupiterLend: BigInt(Math.floor(v.nav.jupiterLend * 1e6)) }) as Nav;

const waitForSwap = async (depositAddress: string, token: string, onStatus: (s: string) => void) => {
  const until = Date.now() + 15 * 60_000;
  while (Date.now() < until) {
    const s = await getJson<{ status: string }>(`/api/withdraw/status?depositAddress=${depositAddress}&token=${encodeURIComponent(token)}`).catch(() => null);
    if (s) {
      onStatus(s.status);
      if (s.status === "SUCCESS" || s.status === "REFUNDED" || s.status === "FAILED") return s.status;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return "PROCESSING";
};

const SWAP_LABEL: Record<string, string> = {
  PENDING_DEPOSIT: "Waiting for the payment to be seen",
  KNOWN_DEPOSIT_TX: "Payment seen, confirming",
  PROCESSING: "Swapping and sending",
  SUCCESS: "Delivered",
  REFUNDED: "Refunded to your Solana wallet",
  FAILED: "Failed — refund pending to your Solana wallet",
  INCOMPLETE_DEPOSIT: "Payment below the quote — refund pending",
};

export default function Withdraw({ identity, position, vaultInfo }: { identity: Identity; position?: Position; vaultInfo?: VaultSummary }) {
  const { api, wallet } = useLandfallWallet();
  const qc = useQueryClient();
  const exec = useExecution({});
  const [pct, setPct] = useState(100);
  const [dest, setDest] = useState<string>(identity.ownsDirectly ? SOLANA : "base-usdc");
  const [recipient, setRecipient] = useState("");
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!position || position.shares <= 0) {
    return (
      <section className="card p-6 md:p-8">
        <p className="eyebrow">Withdraw anywhere</p>
        <p className="mt-3 text-ink-3">Nothing to withdraw yet.</p>
      </section>
    );
  }

  const shares = BigInt(Math.floor(position.shares * 1e6 * (pct / 100)));
  const assets = BigInt(Math.floor(position.value * 1e6 * (pct / 100)));
  const minOut = (assets * 995n) / 1000n;
  const source = vaultInfo ? redeemSourceFor(navOf(vaultInfo), assets) : "idle";
  const destination = WITHDRAW_DESTINATIONS.find((d) => d.id === dest);
  // EVM payouts default to the connected EVM wallet; everything else needs an address
  const defaultRecipient = destination?.evm && identity.originType === "evm" ? identity.wallet : "";
  const to = (recipient.trim() || defaultRecipient).trim();
  const sol = () => {
    const s = wallet.wallet?.getProviders().sol as unknown as SolanaSigner | undefined;
    if (!s) throw new Error("connect your Solana wallet");
    return s;
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["position", identity.owner] });
    qc.invalidateQueries({ queryKey: ["vault"] });
  };

  /** Solana wallet → its own USDC account, one transaction. */
  const toOwnWallet = async () => {
    const owner = new PublicKey(identity.owner);
    await signAndSend(sol(), owner, [createAtaIdempotentIx(owner, owner, USDC_MINT), ...redeemIxs(vault, owner, ata(owner, USDC_MINT), shares, minOut, source)], (sig) =>
      setStatus(`Sent · ${sig.slice(0, 12)}…`),
    );
    setStatus("Withdrawn to your wallet");
  };

  /** Solana wallet → another chain: Swap API quote, then redeem + pay the deposit address in one transaction. */
  const swapOut = async () => {
    const owner = new PublicKey(identity.owner);
    setStatus("Getting a quote…");
    const q = await getJson<SwapQuote>("/api/withdraw/quote", {
      method: "POST",
      body: JSON.stringify({ owner: identity.owner, destination: dest, recipient: to, amount: minOut.toString() }),
    });
    setStatus(`About ${q.amountOutFormatted} ${q.destination.symbol} on ${q.destination.label} · sign to withdraw`);
    const sig = await signAndSend(sol(), owner, swapOutIxs(vault, owner, shares, minOut, source, new PublicKey(q.depositAddress)));
    await getJson("/api/withdraw/submit", { method: "POST", body: JSON.stringify({ txHash: sig, depositAddress: q.depositAddress, token: q.token }) }).catch(() => undefined);
    refresh();
    const final = await waitForSwap(q.depositAddress, q.token, (s) => setStatus(`${SWAP_LABEL[s] ?? s} · ${q.amountOutFormatted} ${q.destination.symbol} → ${q.destination.label}`));
    if (final !== "SUCCESS") throw new Error(SWAP_LABEL[final] ?? final);
  };

  /** EVM wallet → any Solana address: steps-only from its Intents Connect account. */
  const icToSolana = async () => {
    const target = new PublicKey(to);
    const recipe: SolanaRecipe<void> = {
      id: "landfall-withdraw-solana",
      intent: "landfall_withdraw_solana",
      title: "Withdraw from Landfall to Solana",
      type: "solana",
      flow: "steps-only",
      destination: { chain: "sol", assetId: AURORA_ASSETS.solanaUsdc, tokenAddress: USDC_MINT.toBase58() },
      buildSteps: ({ intermediary, amount }) => ({
        steps: withdrawToSolanaSteps(vault, new PublicKey(intermediary), target, shares, minOut, source, BigInt(amount)),
      }),
    };
    const p = await exec.previewSteps({ recipe, params: undefined, amount: minOut.toString(), feeFromAmount: { amountReserveBps: 0 } });
    await exec.runSteps(p.plan);
    setStatus(`Withdrawn to ${target.toBase58().slice(0, 6)}…`);
  };

  /** EVM wallet → any chain: Intents Connect out-operation (redeem on Solana, bridge out). */
  const icOut = async () => {
    if (!wallet.wallet || !destination) throw new Error("connect your wallet");
    if (!to) throw new Error(`enter a ${destination.label} address`);
    const steps = withdrawAnywhereSteps(vault, new PublicKey(identity.owner), shares, minOut, source);
    const res = await fetch(`/api/intents-connect/api/v1/executions/${identity.wallet}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: "1.0",
        type: "solana",
        outOperation: true,
        quote: { originAsset: AURORA_ASSETS.solanaUsdc, destinationAsset: destination.assetId, amount: minOut.toString(), swapType: "EXACT_INPUT", slippageTolerance: 100, recipient: to },
        steps,
        metadata: { title: `Withdraw from Landfall to ${destination.label}`, intent: "landfall_withdraw_out" },
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
    setStatus(`Withdrawing · ${destination.symbol} is on its way to ${destination.label}`);
  };

  const run = async () => {
    setError(undefined);
    setBusy(true);
    try {
      if (identity.ownsDirectly) await (dest === SOLANA ? toOwnWallet() : swapOut());
      else await (dest === SOLANA ? icToSolana() : icOut());
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const needsAddress = dest === SOLANA ? !identity.ownsDirectly : !defaultRecipient;
  const chip = (id: string, label: string) => (
    <button
      key={id}
      onClick={() => {
        setDest(id);
        setRecipient("");
      }}
      className={`rounded-pill border px-3 py-1 text-sm ${dest === id ? "border-ink text-ink" : "border-line-2 text-ink-3 hover:text-ink-2"}`}
    >
      {label}
    </button>
  );

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

      <p className="mt-5 text-sm text-ink-3">Receive on</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {chip(SOLANA, identity.ownsDirectly ? "USDC · this wallet" : "USDC · Solana")}
        {WITHDRAW_DESTINATIONS.map((d) => chip(d.id, `${d.symbol} · ${d.label}`))}
      </div>

      {(needsAddress || (destination && !destination.evm)) && (
        <input
          className="mono mt-4 h-10 w-full rounded-pill border border-line-2 bg-bg-3 px-4 text-sm"
          placeholder={dest === SOLANA ? "Solana address" : `${destination?.label} address`}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />
      )}
      {defaultRecipient && destination?.evm && <p className="mono mt-3 truncate text-xs text-ink-4">to {defaultRecipient}</p>}

      <button className="btn btn-primary mt-5" onClick={run} disabled={busy || exec.isBusy || (needsAddress && !recipient.trim())}>
        {busy ? "Working…" : `Withdraw to ${dest === SOLANA ? (identity.ownsDirectly ? "this wallet" : "Solana") : destination?.label}`}
      </button>
      <p className="mt-3 text-xs text-ink-4">
        {identity.ownsDirectly
          ? dest === SOLANA
            ? "One transaction from your wallet."
            : "One transaction: your shares are redeemed and paid into an Aurora Intents swap. If the swap can't complete, the USDC is refunded to this wallet."
          : dest === SOLANA
            ? "Your Intents Connect account redeems and sends USDC on Solana. One signature."
            : "One signature: your Intents Connect account redeems on Solana and the USDC is bridged out by Aurora Intents."}
      </p>
      {status && <p className="mt-3 text-sm text-ok">{status}</p>}
      {exec.isBusy && <p className="mt-3 text-sm text-ink-3">{exec.phase}…</p>}
      {(error || exec.error) && <p className="mt-3 text-sm text-bad">{error ?? exec.error?.message}</p>}
    </section>
  );
}
