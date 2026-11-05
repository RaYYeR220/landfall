"use client";

import Link from "next/link";
import { VAULT_URL } from "./links";
import { fmtPct, fmtUsd, fmtWeight, useVault } from "./vault-data";

export function VaultLive() {
  const v = useVault();

  if (v.status !== "live") {
    return (
      <div className="lf-vault-quiet" aria-busy={v.status === "loading"}>
        <span className={`lf-pulse${v.status === "loading" ? " lf-pulse-on" : ""}`} aria-hidden="true" />
        <p>{v.status === "loading" ? "Reading the vault on Solana…" : "Vault goes live with the mainnet deployment."}</p>
        <Link className="lf-arrow-link" href={VAULT_URL}>
          Open the vault →
        </Link>
      </div>
    );
  }

  const d = v.data;
  const wk = d.weights.kamino;
  const wj = d.weights.jupiterLend;
  const tot = wk + wj || 1;

  return (
    <div className="lf-vault-live">
      <dl className="lf-vault-grid">
        <div className="lf-vcell">
          <dt>Net asset value</dt>
          <dd className="lf-vnum">{fmtUsd(d.nav.total)}</dd>
          <dd className="lf-vsub">{d.paused ? "Landings paused by the curator" : "USDC across idle, Kamino and Jupiter Lend"}</dd>
        </div>
        <div className="lf-vcell">
          <dt>Blended APY</dt>
          <dd className="lf-vnum lf-acc">{fmtPct(d.apy.blended)}</dd>
          <dd className="lf-vsub">
            Kamino {fmtPct(d.apy.kamino)} · Jupiter Lend {fmtPct(d.apy.jupiterLend)}
          </dd>
        </div>
        <div className="lf-vcell">
          <dt>Curated split</dt>
          <dd className="lf-vnum">
            {fmtWeight(wk)} <span className="lf-vdim">/</span> {fmtWeight(wj)}
          </dd>
          <dd className="lf-vsplit" aria-hidden="true">
            <i style={{ flexGrow: wk / tot }} />
            <i style={{ flexGrow: wj / tot }} />
          </dd>
          <dd className="lf-vsub">Kamino · Jupiter Lend</dd>
        </div>
        <div className="lf-vcell">
          <dt>Deposits landed</dt>
          <dd className="lf-vnum">{d.landed.count.toLocaleString("en-US")}</dd>
          <dd className="lf-vsub">{fmtUsd(d.landed.total)} in total</dd>
        </div>
      </dl>
      <div className="lf-vault-foot">
        <span className="lf-live-dot" aria-hidden="true" />
        Read live from Solana mainnet
        <Link className="lf-arrow-link" href={VAULT_URL}>
          Open the vault →
        </Link>
      </div>
    </div>
  );
}
