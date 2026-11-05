"use client";

import { useEffect, useState } from "react";

/** The subset of `GET /api/vault` the landing page reads. */
export type VaultSummary = {
  nav: { total: number; idle: number; kamino: number; jupiterLend: number };
  apy: { kamino: number; jupiterLend: number; blended: number };
  weights: { kamino: number; jupiterLend: number; idleBuffer: number };
  landed: { total: number; count: number };
  paused: boolean;
};

export type VaultState = { status: "loading" } | { status: "live"; data: VaultSummary } | { status: "off" };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const parse = (b: unknown): VaultSummary | null => {
  const o = b as Partial<VaultSummary> | null;
  const total = num(o?.nav?.total);
  const blended = num(o?.apy?.blended);
  if (total === null || blended === null) return null;
  return {
    nav: { total, idle: num(o?.nav?.idle) ?? 0, kamino: num(o?.nav?.kamino) ?? 0, jupiterLend: num(o?.nav?.jupiterLend) ?? 0 },
    apy: { kamino: num(o?.apy?.kamino) ?? 0, jupiterLend: num(o?.apy?.jupiterLend) ?? 0, blended },
    weights: { kamino: num(o?.weights?.kamino) ?? 0, jupiterLend: num(o?.weights?.jupiterLend) ?? 0, idleBuffer: num(o?.weights?.idleBuffer) ?? 0 },
    landed: { total: num(o?.landed?.total) ?? 0, count: num(o?.landed?.count) ?? 0 },
    paused: Boolean(o?.paused),
  };
};

let pending: Promise<VaultSummary | null> | null = null;

/** One fetch per page view, shared by every component that reads the vault. Never throws. */
export const loadVault = () => {
  if (!pending) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    pending = fetch("/api/vault", { cache: "no-store", signal: ctrl.signal })
      .then((r) => (r.status === 200 ? r.json() : null))
      .then(parse)
      .catch(() => null)
      .finally(() => clearTimeout(timer));
  }
  return pending;
};

export function useVault(): VaultState {
  const [state, setState] = useState<VaultState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    loadVault().then((data) => {
      if (alive) setState(data ? { status: "live", data } : { status: "off" });
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

export const fmtUsd = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: v >= 10_000 ? 0 : 2, maximumFractionDigits: v >= 10_000 ? 0 : 2 });

/** APYs arrive as fractions (0.0512); tolerate an already-percent value. */
export const fmtPct = (v: number) => `${(v > 1.5 ? v : v * 100).toFixed(2)}%`;

export const fmtWeight = (v: number) => `${Math.round(v)}%`;
