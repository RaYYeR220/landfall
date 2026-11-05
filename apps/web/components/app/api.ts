"use client";

export type Identity = {
  wallet: string;
  originType: string;
  owner: string;
  intermediary: string;
  ownsDirectly: boolean;
  inbox: string;
  inboxUsdc: string;
  shares: string;
};

export type ChainAddress = {
  chain: string;
  label: string;
  covers?: string[];
  address: string | null;
  memo?: string | null;
  assets: { symbol: string; assetId: string; decimals: number }[];
  minimumUsd: number;
  error?: string;
};

export type AddressBook = {
  owner: string;
  inbox: string;
  inboxUsdc: string;
  confidential: boolean;
  status: "ready" | "pending-approval" | "error";
  chains: ChainAddress[];
};

export type ChainEvent =
  | { kind: "landed"; signature: string; slot: number; time: number | null; source: "direct" | "inbox"; amount: number; shares: number; depositor: string }
  | { kind: "redeemed"; signature: string; slot: number; time: number | null; amount: number; shares: number; destination: string };

export type Position = {
  owner: string;
  shares: number;
  value: number;
  sharePrice: number;
  inbox: { address: string; usdcAccount: string; exists: boolean; pendingUsdc: number };
  looseUsdc: number;
  history: ChainEvent[];
};

export type VaultSummary = {
  vault: string;
  shareMint: string;
  programId: string;
  nav: { total: number; idle: number; kamino: number; jupiterLend: number };
  sharePrice: number;
  shareSupply: number;
  apy: { kamino: number; jupiterLend: number; blended: number };
  weights: { kamino: number; jupiterLend: number; idleBuffer: number };
  caps: { kamino: number; jupiterLend: number };
  paused: boolean;
  landed: { total: number; count: number };
  redeemed: number;
  curator: string;
};

export type Activity = {
  owner: string;
  addressStatus: string;
  deposits: { chain: string; address: string; status: "received" | "success" | "failed"; tx: string; amount: string; decimals: number | null; asset: string | null; at: string; from?: string }[];
  executions: { id?: string; status?: string; createdAt?: string; metadata?: { title?: string }; quote?: { amountIn?: string; amountOut?: string; originAsset?: string; depositAddress?: string } }[];
  chain: ChainEvent[];
};

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const getJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string }).error ?? `request failed (${res.status})`);
  return body as T;
};

export const usd = (n: number, digits = 2) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });

export const short = (s: string, head = 4, tail = 4) => (s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`);

export const solscanTx = (sig: string) => `https://solscan.io/tx/${sig}`;
export const solscanAccount = (a: string) => `https://solscan.io/account/${a}`;
