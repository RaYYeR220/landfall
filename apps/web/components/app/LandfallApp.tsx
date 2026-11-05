"use client";

import SiteHeader from "../SiteHeader";
import { short, usd } from "./api";
import { useActivity, useIdentity, usePosition, useVault } from "./hooks";
import { useLandfallWallet } from "./Providers";
import AddressBook from "./AddressBook";
import WalletDeposit from "./WalletDeposit";
import Recovery from "./Recovery";
import Withdraw from "./Withdraw";
import ActivityList from "./ActivityList";

const Header = () => {
  const { wallet } = useLandfallWallet();
  return (
    <SiteHeader current="app">
      {wallet.isConnected ? (
        <button className="btn btn-ghost h-10" onClick={() => wallet.disconnect()} title="Disconnect">
          <span className="inline-block h-2 w-2 rounded-full bg-ok" />
          <span className="mono text-sm">{short(wallet.address ?? "")}</span>
        </button>
      ) : (
        <button className="btn btn-primary h-10" onClick={() => wallet.connect()} disabled={wallet.isConnecting}>
          {wallet.isConnecting ? "Connecting…" : "Connect wallet"}
        </button>
      )}
    </SiteHeader>
  );
};

export default function LandfallApp() {
  const { wallet } = useLandfallWallet();
  const identity = useIdentity(wallet.address);
  const position = usePosition(identity.data?.owner);
  const vault = useVault();
  const activity = useActivity(identity.data?.owner, identity.data?.wallet);

  return (
    <div className="min-h-screen">
      <Header />
      <main className="wrap pb-24 pt-6">
        {!wallet.isConnected && (
          <section className="card mx-auto mt-10 max-w-2xl p-8 text-center md:p-12">
            <p className="eyebrow">Landfall</p>
            <h1 className="mt-3 text-[clamp(32px,5vw,52px)] font-medium leading-[1.05] tracking-[-0.04em]">Your addresses on every chain</h1>
            <p className="mx-auto mt-4 max-w-md text-ink-2">
              Connect an EVM or Solana wallet once. You get a permanent deposit address on 30+ chains, and everything sent to them lands in a Solana USDC vault.
            </p>
            <button className="btn btn-primary mt-7" onClick={() => wallet.connect()}>
              Connect wallet
            </button>
            <p className="mt-5 text-xs text-ink-4">
              EVM wallets own their vault shares through their Intents Connect Solana account — controlled only by the wallet&apos;s own signature.
            </p>
          </section>
        )}

        {wallet.isConnected && identity.isLoading && <p className="mt-10 text-ink-3">Resolving your Solana account…</p>}
        {identity.error && <p className="mt-10 text-bad">{(identity.error as Error).message}</p>}

        {identity.data && (
          <div className="grid gap-6">
            <section className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
              <div className="card p-6 md:p-8">
                <p className="eyebrow">Your position</p>
                <p className="mt-3 text-[clamp(36px,5vw,56px)] font-medium tracking-[-0.04em]">{usd(position.data?.value ?? 0)}</p>
                <p className="mono mt-1 text-sm text-ink-3">
                  {(position.data?.shares ?? 0).toLocaleString("en-US", { maximumFractionDigits: 6 })} lfUSDC · {(position.data?.sharePrice ?? 1).toFixed(6)} USDC each
                </p>
                {vault.data && (
                  <p className="mt-4 text-sm text-ink-2">
                    Earning {(vault.data.apy.blended * 100).toFixed(2)}% · Kamino {vault.data.weights.kamino}% / Jupiter Lend {vault.data.weights.jupiterLend}%
                  </p>
                )}
              </div>
              <div className="card p-6 md:p-8 text-sm">
                <p className="eyebrow">Your accounts</p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                  <dt className="text-ink-3">Wallet</dt>
                  <dd className="mono truncate">{identity.data.wallet}</dd>
                  <dt className="text-ink-3">Share owner</dt>
                  <dd className="mono truncate">
                    <a href={`https://solscan.io/account/${identity.data.owner}`} target="_blank" rel="noreferrer" className="hover:text-acc">
                      {identity.data.owner}
                    </a>
                  </dd>
                  <dt className="text-ink-3">Inbox</dt>
                  <dd className="mono truncate">{identity.data.inbox}</dd>
                </dl>
                <p className="mt-3 text-xs text-ink-4">
                  {identity.data.ownsDirectly ? "Your Solana wallet owns its shares directly." : "Your shares live in your Intents Connect Solana account, which only your wallet can move."}
                </p>
              </div>
            </section>

            <AddressBook identity={identity.data} />
            <WalletDeposit identity={identity.data} />
            <div className="grid gap-6 md:grid-cols-2">
              <Withdraw identity={identity.data} position={position.data} vaultInfo={vault.data} />
              <Recovery identity={identity.data} position={position.data} activity={activity.data} />
            </div>
            <ActivityList activity={activity.data} />
          </div>
        )}
      </main>
    </div>
  );
}
