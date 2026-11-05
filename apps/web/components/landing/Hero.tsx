"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./landing.css";
import { AddressRoll } from "./AddressRoll";
import { compactText, fullText, readoutFor } from "./chains";
import { useLiveDeposit } from "./LiveDeposit";
import { Arrow, Logo } from "./Logo";
import { APP_URL, DOCS_URL, VAULT_URL } from "./links";
import { fmtPct, fmtUsd, useVault } from "./vault-data";
import { startVortex, type Vortex } from "./vortex";

type DropDetail = { arm: string; from?: string; to?: string };

const delay = (d: string) => ({ "--d": d }) as CSSProperties;

export function Hero() {
  const heroRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const vortexRef = useRef<Vortex | null>(null);
  const [arm, setArm] = useState("trx");
  const vault = useVault();
  const { open } = useLiveDeposit();

  useEffect(() => {
    const hero = heroRef.current;
    const canvas = canvasRef.current;
    const anchor = anchorRef.current;
    const text = textRef.current;
    if (!hero || !canvas || !anchor || !text) return;
    const v = startVortex({
      hero,
      canvas,
      anchor,
      exclude: [text, anchor],
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      onActive: setArm,
    });
    vortexRef.current = v;
    const onDrop = (e: Event) => {
      const d = (e as CustomEvent<DropDetail>).detail;
      if (d?.arm) v.drop(d.arm, d.from, d.to);
    };
    window.addEventListener("landfall:drop", onDrop);
    return () => {
      window.removeEventListener("landfall:drop", onDrop);
      v.destroy();
      vortexRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (vault.status !== "live") return;
    const { kamino, jupiterLend } = vault.data.weights;
    if (kamino + jupiterLend > 0) vortexRef.current?.setWeights(kamino, jupiterLend);
  }, [vault]);

  const r = readoutFor(arm);
  const proof =
    vault.status === "live"
      ? `Live on Solana mainnet · NAV ${fmtUsd(vault.data.nav.total)} · ${fmtPct(vault.data.apy.blended)} APY`
      : "Solana mainnet · Powered by Aurora Intents";

  return (
    <section className="lf-hero" id="top" ref={heroRef}>
      <canvas
        ref={canvasRef}
        className="lf-field"
        role="img"
        aria-label="Deposit streaks spiral in from every source chain into one core labelled lfUSDC on Solana, which sheds a Kamino stream and a Jupiter Lend stream"
      />
      <div className="lf-scrim" aria-hidden="true" />

      <header className="lf-nav">
        <div className="wrap lf-nav-in">
          <Link className="lf-brand" href="/" aria-label="Landfall home">
            <Logo />
            Landfall
          </Link>
          <nav className="lf-links" aria-label="Primary">
            <a href="#how">How it works</a>
            <Link href={VAULT_URL}>Vault</Link>
            <a href={DOCS_URL} target="_blank" rel="noreferrer">
              Docs
            </a>
          </nav>
          <Link className="lf-nav-cta" href={APP_URL}>
            Get your address
          </Link>
        </div>
      </header>

      <div className="lf-copy">
        <div className="lf-copy-text" ref={textRef}>
          <h1 className="lf-h1 lf-rise" style={delay(".06s")}>
            <span className="lf-l">The address</span> <span className="lf-l">is the instruction.</span>
          </h1>
          <p className="lf-sub lf-rise" style={delay(".14s")}>
            One permanent address on every chain. Send from a wallet, an exchange or Bitcoin — it lands on Solana as shares of a curated USDC vault lending on Kamino
            and Jupiter Lend. No signature per deposit.
          </p>
          <div className="lf-ctas lf-rise" style={delay(".22s")}>
            <Link className="btn btn-primary lf-btn" href={APP_URL}>
              Get your address
              <Arrow />
            </Link>
            <button type="button" className="btn btn-ghost lf-btn" onClick={open}>
              <i className="lf-dot" aria-hidden="true" />
              Fire a live deposit
            </button>
          </div>
          <p className="lf-proof lf-rise" style={delay(".3s")}>
            <i aria-hidden="true" />
            <span key={proof} className="lf-swap">
              {proof}
            </span>
          </p>
        </div>

        <div className="lf-readout lf-fade" style={delay(".42s")} ref={anchorRef}>
          <p className="lf-ro-head">
            <span key={r.name} className="lf-swap">
              <b>{r.name}</b> deposit address
            </span>
            <span className="lf-tag">sample</span>
          </p>
          <p className="lf-ro-addr">
            <AddressRoll text={fullText(r.groups)} className="lf-only-wide" />
            <AddressRoll text={compactText(r.groups)} className="lf-only-narrow" />
            <span className="lf-sr">
              {r.name} deposit address, sample: {fullText(r.groups)}
            </span>
          </p>
          <p key={r.req} className="lf-ro-req lf-swap">
            {r.req}
          </p>
        </div>
      </div>

      <div className="lf-hero-space" aria-hidden="true" />

      <div className="lf-foot lf-rise" style={delay(".7s")}>
        <div className="wrap lf-foot-in">
          <span className="lf-only-wide">
            <b>Each arm is one chain.</b> Spiral length follows typical arrival · Bitcoin’s ~14 min plays in 14 s · amounts and timings illustrative
          </span>
          <span className="lf-only-narrow">
            <b>Each arm is one chain.</b> 8 of 22 shown · tap one · illustrative
          </span>
          <span className="lf-hint lf-only-wide">Point at a chain to see its address · click to drop a deposit</span>
        </div>
      </div>
    </section>
  );
}
