import "server-only";
import { PublicKey, sendAndConfirmTransaction, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { AURORA_ASSETS, AuroraHttpError, inboxAddresses, openInboxIx, PERSISTENT_CHAINS, type DepositChain } from "@landfall/sdk";
import { connection, intents, keeper, vault } from "./env";

export type SupportedAsset = { symbol: string; assetId: string; decimals: number; contractAddress?: string };

export type ChainAddress = {
  chain: DepositChain;
  label: string;
  covers?: string[];
  address: string | null;
  memo?: string | null;
  assets: SupportedAsset[];
  /** Aurora's recommended minimum, below which a deposit may not be processed. */
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

// 1Click lists the assets each source chain accepts (public, cached).
let tokensCache: { at: number; byChain: Map<string, SupportedAsset[]> } | undefined;
const ONECLICK_CHAIN: Partial<Record<DepositChain, string[]>> = {
  evm: ["eth", "base", "arb", "op", "pol", "bsc", "avax", "gnosis", "scroll", "monad", "bera", "xlayer", "plasma", "hood"],
};
export const supportedAssets = async (): Promise<Map<string, SupportedAsset[]>> => {
  if (tokensCache && Date.now() - tokensCache.at < 10 * 60_000) return tokensCache.byChain;
  const list = (await fetch("https://1click.chaindefuser.com/v0/tokens", { next: { revalidate: 600 } }).then((r) => r.json())) as (SupportedAsset & { blockchain: string })[];
  const byChain = new Map<string, SupportedAsset[]>();
  for (const t of list) {
    const arr = byChain.get(t.blockchain) ?? [];
    arr.push({ symbol: t.symbol, assetId: t.assetId, decimals: t.decimals, contractAddress: t.contractAddress });
    byChain.set(t.blockchain, arr);
  }
  tokensCache = { at: Date.now(), byChain };
  return byChain;
};

const assetsFor = (byChain: Map<string, SupportedAsset[]>, chain: DepositChain) => {
  const chains = ONECLICK_CHAIN[chain] ?? [chain];
  const seen = new Set<string>();
  return chains.flatMap((c) => byChain.get(c) ?? []).filter((a) => (seen.has(a.symbol) ? false : (seen.add(a.symbol), true)));
};

export const inboxExists = async (owner: PublicKey) =>
  Boolean(await connection().getAccountInfo(inboxAddresses(vault, owner).inboxUsdc, "confirmed"));

// Global cap on keeper-paid inbox creations (rent ≈ 0.0035 SOL each), per instance.
let createdWindow = { at: Date.now(), n: 0 };
const MAX_NEW_INBOXES_PER_HOUR = Number(process.env.MAX_NEW_INBOXES_PER_HOUR ?? 60);

/**
 * Opens the owner's inbox (and its USDC account) if it doesn't exist yet. The
 * keeper pays the rent, so callers must have verified the owner first.
 */
export const ensureInbox = async (owner: PublicKey, allowCreate: boolean) => {
  const a = inboxAddresses(vault, owner);
  if (await inboxExists(owner)) return { ...a, created: false };
  if (!allowCreate) throw Object.assign(new Error("sign in with your wallet to open your deposit addresses"), { status: 401 });
  if (Date.now() - createdWindow.at > 3_600_000) createdWindow = { at: Date.now(), n: 0 };
  if (++createdWindow.n > MAX_NEW_INBOXES_PER_HOUR) throw Object.assign(new Error("too many new accounts right now, try again later"), { status: 429 });
  const k = keeper();
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }), openInboxIx(vault, k.publicKey, owner));
  await sendAndConfirmTransaction(connection(), tx, [k], { commitment: "confirmed", maxRetries: 3 });
  return { ...a, created: true };
};

const cache = new Map<string, AddressBook>();

/** Every chain's persistent deposit address for `owner`, all paying into the owner's inbox. */
// concurrent requests for the same owner share one build, so Aurora is never asked to mint the same address twice at once
const inflight = new Map<string, Promise<AddressBook>>();

export const addressBook = async (owner: PublicKey, opts: { confidential?: boolean; allowCreate?: boolean } = {}): Promise<AddressBook> => {
  const key = `${owner.toBase58()}:${Boolean(opts.confidential)}:${Boolean(opts.allowCreate)}`;
  const running = inflight.get(key);
  if (running) return running;
  const p = buildAddressBook(owner, opts).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
};

const buildAddressBook = async (owner: PublicKey, opts: { confidential?: boolean; allowCreate?: boolean }): Promise<AddressBook> => {
  const confidential = Boolean(opts.confidential);
  const key = `${owner.toBase58()}:${confidential}`;
  const hit = cache.get(key);
  if (hit && hit.status === "ready") return hit;

  const a = await ensureInbox(owner, Boolean(opts.allowCreate));
  const byChain = await supportedAssets().catch(() => new Map<string, SupportedAsset[]>());
  let status: AddressBook["status"] = "ready";
  const chains: ChainAddress[] = [];
  // a few at a time: 100 req / 10 s per endpoint
  for (let i = 0; i < PERSISTENT_CHAINS.length; i += 4) {
    const batch = PERSISTENT_CHAINS.slice(i, i + 4);
    const results = await Promise.all(
      batch.map(async (c): Promise<ChainAddress> => {
        const base = { chain: c.chain, label: c.label, covers: c.covers, assets: assetsFor(byChain, c.chain), minimumUsd: c.chain === "tron" ? 2 : 1 };
        try {
          const r = await intents().createPersistentAddress({
            recipient: a.inbox.toBase58(),
            sender: owner.toBase58(),
            depositChain: c.chain,
            destinationChain: "sol",
            destinationAsset: AURORA_ASSETS.solanaUsdc,
            confidential,
          });
          const address = (r.depositAddress ?? (r as { address?: string }).address ?? null) as string | null;
          return { ...base, address, memo: (r.memo as string | undefined) ?? null };
        } catch (e) {
          if (e instanceof AuroraHttpError && e.status === 403) status = "pending-approval";
          else if (status === "ready") status = "error";
          return { ...base, address: null, error: (e as Error).message };
        }
      }),
    );
    chains.push(...results);
  }
  const book: AddressBook = { owner: owner.toBase58(), inbox: a.inbox.toBase58(), inboxUsdc: a.inboxUsdc.toBase58(), confidential, status, chains };
  if (cache.size > 2_000) cache.clear();
  cache.set(key, book);
  return book;
};
