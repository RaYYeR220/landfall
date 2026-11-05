"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { signIntentsConnectText } from "@aurora-is-near/intents-connect";
import { ownershipMessage } from "@/lib/shared/ownership";
import { getJson, type AddressBook as Book, type ChainAddress, type Identity } from "./api";
import { useLandfallWallet } from "./Providers";

const ARRIVAL: Record<string, string> = { evm: "under a minute", sol: "about 25 seconds", tron: "1–2 minutes", ton: "about a minute", btc: "about 14 minutes" };

/** Aurora's rule: an address is never shown without what may be sent to it. */
const requirements = (c: ChainAddress) => {
  const assets = c.assets.map((a) => a.symbol).slice(0, 8);
  const list = assets.length > 1 ? `${assets.slice(0, -1).join(", ")} or ${assets.at(-1)}` : (assets[0] ?? "supported assets");
  const network = c.chain === "evm" ? "Ethereum or any listed EVM network" : `the ${c.label} network`;
  return `Send only ${list} from ${network}. Minimum $${c.minimumUsd}. Anything else may not be processed.`;
};

const Qr = ({ value }: { value: string }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    import("qr-code-styling").then(({ default: QRCodeStyling }) => {
      if (cancelled || !ref.current) return;
      ref.current.replaceChildren();
      const qr = new QRCodeStyling({
        width: 152,
        height: 152,
        data: value,
        margin: 0,
        dotsOptions: { color: "#e9ebee", type: "rounded" },
        backgroundOptions: { color: "transparent" },
        cornersSquareOptions: { type: "extra-rounded", color: "#e9ebee" },
        cornersDotOptions: { color: "#5fd4f4" },
      });
      qr.append(ref.current);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  return <div ref={ref} className="h-[152px] w-[152px] shrink-0" aria-label="QR code of the deposit address" />;
};

export default function AddressBook({ identity }: { identity: Identity }) {
  const { wallet } = useLandfallWallet();
  const qc = useQueryClient();
  const [confidential, setConfidential] = useState(false);
  const [selected, setSelected] = useState("evm");
  const [copied, setCopied] = useState(false);

  const load = useMutation({
    mutationFn: async (opts: { sign: boolean }) => {
      const body: Record<string, unknown> = { owner: identity.owner, confidential };
      if (opts.sign) {
        if (!wallet.wallet) throw new Error("connect a wallet first");
        const issuedAt = new Date().toISOString();
        const env = await signIntentsConnectText({
          text: ownershipMessage(identity.owner, issuedAt),
          standard: wallet.wallet.signingStandard,
          address: identity.wallet,
          providers: wallet.wallet.getProviders(),
        });
        body.proof = { wallet: identity.wallet, owner: identity.owner, issuedAt, signature: env.signature };
      }
      return getJson<Book>("/api/addresses", { method: "POST", body: JSON.stringify(body) });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["position", identity.owner] }),
  });

  // try silently first: an existing inbox needs no signature
  useEffect(() => {
    load.mutate({ sign: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.owner, confidential]);

  const book = load.data;
  const needsSignIn = load.error && /sign in/i.test(String((load.error as Error).message));
  const current = useMemo(() => book?.chains.find((c) => c.chain === selected) ?? book?.chains[0], [book, selected]);

  return (
    <section className="card p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Your permanent deposit addresses</p>
          <h2 className="mt-2 text-2xl font-medium tracking-tight">One address per chain. All of them land here.</h2>
          <p className="mt-2 max-w-xl text-[15px] text-ink-2">
            Send from any wallet or exchange. Each deposit is swapped to USDC by Aurora Intents and lands in your inbox on Solana; the keeper sweeps it into the vault, no signature needed.
          </p>
        </div>
        <label className="flex cursor-pointer select-none items-center gap-3 rounded-pill border border-line-2 px-4 py-2 text-sm text-ink-2">
          <input type="checkbox" className="accent-[var(--acc)]" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />
          Private addresses
          <span className="text-ink-4">· hides the sending wallet (Confidential Intents)</span>
        </label>
      </div>

      {load.isPending && <p className="mt-8 text-ink-3">Preparing your addresses…</p>}

      {needsSignIn && (
        <div className="mt-8 flex flex-wrap items-center gap-4 rounded-field border border-line p-5">
          <p className="text-ink-2">Opening your addresses creates your inbox on Solana (we pay the rent). Sign a free message to confirm it is your wallet.</p>
          <button className="btn btn-primary" onClick={() => load.mutate({ sign: true })} disabled={load.isPending}>
            Sign and open my addresses
          </button>
        </div>
      )}

      {load.error && !needsSignIn && <p className="mt-8 text-bad">{(load.error as Error).message}</p>}

      {book?.status === "pending-approval" && (
        <p className="mt-8 rounded-field border border-warn/40 p-4 text-warn">
          Persistent addresses are waiting on Aurora to enable them for this deployment. Until then, deposit from your wallet below — it lands in the same vault.
        </p>
      )}

      {book && book.status !== "pending-approval" && current && (
        <div className="mt-8">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Source chain">
            {book.chains.map((c) => (
              <button
                key={c.chain}
                role="tab"
                aria-selected={c.chain === current.chain}
                onClick={() => setSelected(c.chain)}
                className={`rounded-pill border px-3.5 py-1.5 text-sm transition-colors ${c.chain === current.chain ? "border-ink text-ink" : "border-line-2 text-ink-3 hover:text-ink"}`}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="text-sm text-ink-3">
                Sending from <span className="text-ink">{current.label}</span> · {current.assets.length} asset{current.assets.length === 1 ? "" : "s"} supported
                {current.covers ? <span className="text-ink-4"> · same address on {current.covers.length} EVM networks</span> : null}
              </div>
              <div className="mt-3 flex items-center gap-3 rounded-[40px] border border-line-2 px-5 py-4">
                <code className="mono min-w-0 flex-1 truncate text-[clamp(15px,2.2vw,26px)] tracking-tight">{current.address ?? "unavailable"}</code>
                {current.address && (
                  <button
                    className="btn btn-primary h-10 shrink-0"
                    onClick={async () => {
                      await navigator.clipboard.writeText(current.address!);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                )}
              </div>
              {current.memo && (
                <div className="mt-3 rounded-field border border-warn/40 px-4 py-3 text-sm">
                  Memo (required): <code className="mono text-warn">{current.memo}</code>
                </div>
              )}
              <div className="mt-4 rounded-field border border-line p-4 text-sm">
                <p className="eyebrow mb-1">Transfer requirements</p>
                <p className="text-ink">{requirements(current)}</p>
                <p className="mt-1 text-ink-3">Typical arrival: {ARRIVAL[current.chain] ?? "varies by network"} · lands as lfUSDC vault shares on Solana.</p>
              </div>
              {current.error && <p className="mt-3 text-sm text-bad">{current.error}</p>}
            </div>
            {current.address && <Qr value={current.address} />}
          </div>
        </div>
      )}
    </section>
  );
}
