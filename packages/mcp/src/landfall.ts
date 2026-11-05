/**
 * Landfall operations for agents. Reads go through the public Landfall API;
 * transactions are built locally and returned unsigned, so the agent's wallet
 * (or the user) signs them. Nothing here holds a key.
 */
import { Connection, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  ata,
  createAtaIdempotentIx,
  depositIx,
  redeemIxs,
  redeemSourceFor,
  swapOutIxs,
  USDC_MINT,
  vaultAddresses,
  WITHDRAW_DESTINATIONS,
  type Nav,
} from "@landfall/sdk";

export type Config = { baseUrl: string; rpcUrl: string; fetch?: typeof fetch };

type VaultSummary = { nav: { total: number; idle: number; kamino: number; jupiterLend: number }; sharePrice: number; paused: boolean };
type Position = { owner: string; shares: number; value: number; sharePrice: number };
type Identity = { wallet: string; owner: string; ownsDirectly: boolean; inbox: string };

const vault = vaultAddresses();
const base = (n: number) => BigInt(Math.floor(n * 1e6));

export const createLandfall = (cfg: Config) => {
  const f = cfg.fetch ?? fetch;
  const api = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await f(new URL(path, cfg.baseUrl), { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(body.error ?? `${path} failed (${res.status})`);
    return body as T;
  };
  const conn = new Connection(cfg.rpcUrl, { commitment: "confirmed", ...(cfg.fetch ? { fetch: cfg.fetch } : {}) });

  const unsigned = async (feePayer: PublicKey, ixs: TransactionInstruction[]) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = feePayer;
    tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  };

  const navOf = (v: VaultSummary): Nav => ({ idle: base(v.nav.idle), kamino: base(v.nav.kamino), jupiterLend: base(v.nav.jupiterLend) }) as Nav;

  return {
    vault: async () => {
      const [summary, health] = await Promise.all([api<unknown>("/api/vault"), api<unknown>("/api/vault/health").catch(() => null)]);
      return { summary, health };
    },

    identity: (wallet: string) => api<Identity>(`/api/identity?wallet=${encodeURIComponent(wallet)}`),

    addresses: async (wallet: string, confidential = false) => {
      const id = await api<Identity>(`/api/identity?wallet=${encodeURIComponent(wallet)}`);
      return api<unknown>("/api/addresses", { method: "POST", body: JSON.stringify({ owner: id.owner, confidential }) });
    },

    position: async (wallet: string) => {
      const id = await api<Identity>(`/api/identity?wallet=${encodeURIComponent(wallet)}`);
      return api<Position>(`/api/position?owner=${id.owner}&history=1`);
    },

    activity: async (wallet: string) => {
      const id = await api<Identity>(`/api/identity?wallet=${encodeURIComponent(wallet)}`);
      return api<unknown>(`/api/activity?owner=${id.owner}&wallet=${encodeURIComponent(wallet)}`);
    },

    /** Unsigned deposit for a Solana wallet: USDC from the wallet into the vault, shares to the wallet. */
    buildDeposit: async (wallet: string, amountUsdc: number) => {
      const w = new PublicKey(wallet);
      if (!(amountUsdc > 0)) throw new Error("amount must be positive");
      const tx = await unsigned(w, [createAtaIdempotentIx(w, w, vault.shareMint), depositIx(vault, w, w, base(amountUsdc))]);
      return { transaction: tx, encoding: "base64", signer: wallet, summary: `Deposit ${amountUsdc} USDC into Landfall; lfUSDC shares go to ${wallet}.` };
    },

    /**
     * Unsigned withdrawal for a Solana wallet that owns its shares: to itself,
     * or to another chain through an Aurora Swap API quote (one transaction).
     */
    buildWithdraw: async (wallet: string, percent: number, destination: string, recipient?: string) => {
      const w = new PublicKey(wallet);
      const [pos, v] = await Promise.all([api<Position>(`/api/position?owner=${wallet}`), api<VaultSummary>("/api/vault")]);
      if (pos.shares <= 0) throw new Error("this wallet holds no lfUSDC");
      const p = Math.min(100, Math.max(1, percent)) / 100;
      const shares = base(pos.shares * p);
      const assets = base(pos.value * p);
      const minOut = (assets * 995n) / 1000n;
      const source = redeemSourceFor(navOf(v), assets);
      if (destination === "solana") {
        const tx = await unsigned(w, [createAtaIdempotentIx(w, w, USDC_MINT), ...redeemIxs(vault, w, ata(w, USDC_MINT), shares, minOut, source)]);
        return { transaction: tx, encoding: "base64", signer: wallet, summary: `Withdraw at least ${Number(minOut) / 1e6} USDC to ${wallet} on Solana.` };
      }
      const dest = WITHDRAW_DESTINATIONS.find((d) => d.id === destination);
      if (!dest) throw new Error(`destination must be "solana" or one of ${WITHDRAW_DESTINATIONS.map((d) => d.id).join(", ")}`);
      if (!recipient) throw new Error(`recipient (a ${dest.label} address) is required`);
      const q = await api<{ depositAddress: string; token: string; amountOutFormatted: string; timeEstimate: number }>("/api/withdraw/quote", {
        method: "POST",
        body: JSON.stringify({ owner: wallet, destination: dest.id, recipient, amount: minOut.toString() }),
      });
      const tx = await unsigned(w, swapOutIxs(vault, w, shares, minOut, source, new PublicKey(q.depositAddress)));
      return {
        transaction: tx,
        encoding: "base64",
        signer: wallet,
        depositAddress: q.depositAddress,
        token: q.token,
        summary: `Withdraw about ${q.amountOutFormatted} ${dest.symbol} to ${recipient} on ${dest.label} (~${q.timeEstimate}s after confirmation). Refunds go back to ${wallet}. After sending, call withdraw_status.`,
      };
    },

    withdrawStatus: async (depositAddress: string, token: string, txHash?: string) => {
      if (txHash) await api("/api/withdraw/submit", { method: "POST", body: JSON.stringify({ txHash, depositAddress, token }) }).catch(() => undefined);
      return api<{ status: string }>(`/api/withdraw/status?depositAddress=${depositAddress}&token=${encodeURIComponent(token)}`);
    },
  };
};
