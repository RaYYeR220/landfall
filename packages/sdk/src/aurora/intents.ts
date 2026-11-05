/**
 * Aurora Intents REST clients used by Landfall: Persistent deposit addresses
 * (Intents Deposits) and the Swap API (incl. Confidential Intents). The API key
 * is passed in by the caller (server side) and never embedded in clients.
 */
import { AURORA } from "../constants";

export type DepositChain =
  | "eth" | "bera" | "base" | "gnosis" | "arb" | "bsc" | "avax" | "op" | "pol" | "monad" | "adi" | "plasma" | "scroll" | "xlayer" | "hood"
  | "sui" | "aptos" | "xrp" | "btc" | "doge" | "tron" | "ton" | "near" | "sol" | "zec" | "ltc" | "cardano" | "stellar" | "aleo" | "bch"
  | "dash" | "starknet" | "evm";

export type PersistentAddress = { depositAddress: string; memo?: string | null; [k: string]: unknown };

export type PersistentDeposit = {
  tx_hash: string;
  fromChain?: string | null;
  destinationChain?: string | null;
  asset_id: string | null;
  decimals: number | null;
  amount: string;
  from?: string;
  created_at: string;
  intents_account: string;
  deposit_address: string;
  recipient: string;
};

export type QuoteRequest = {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  deadline: string;
  confidentiality?: "advanced";
};

export type SwapStatus = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

export class AuroraHttpError extends Error {
  constructor(readonly status: number, readonly body: string, readonly retryAfter?: number) {
    super(`Aurora API ${status}: ${body.slice(0, 200)}`);
  }
}

export type IntentsClientOptions = { apiKey: string; baseUrl?: string; fetch?: typeof fetch };

export const createIntentsClient = ({ apiKey, baseUrl = AURORA.intentsApi, fetch: f = fetch }: IntentsClientOptions) => {
  const call = async <T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> => {
    const res = await f(`${baseUrl}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new AuroraHttpError(res.status, text, Number(res.headers.get("retry-after")) || undefined);
    return (text ? JSON.parse(text) : {}) as T;
  };
  const k = encodeURIComponent(apiKey);
  return {
    /** Deterministic per (key, sender, recipient, destination, confidential, chain); EVM chains share one. */
    createPersistentAddress: (p: {
      recipient: string;
      sender: string;
      depositChain: DepositChain;
      destinationChain: "sol";
      destinationAsset: string;
      confidential?: boolean;
    }) => call<PersistentAddress>("POST", `/api/persistent-deposit-address/${k}`, { recipientType: "DESTINATION_CHAIN", ...p }),
    persistentDeposits: (address: string, type: "received" | "success" | "failed", limit = 50) =>
      call<{ deposits: PersistentDeposit[] }>("GET", `/api/persistent-deposit-status/${k}?type=${type}&address=${encodeURIComponent(address)}&limit=${limit}`),
    quote: (q: QuoteRequest) => call<{ quote: Record<string, string> & { depositAddress?: string }; quoteRequest: QuoteRequest }>("POST", `/api/quote/${k}`, q),
    swapStatus: (depositAddress: string, memo?: string) =>
      call<{ status: SwapStatus; [k: string]: unknown }>(
        "GET",
        `/api/status/${k}?depositAddress=${encodeURIComponent(depositAddress)}${memo ? `&depositMemo=${encodeURIComponent(memo)}` : ""}`,
      ),
    notifyDeposit: (depositAddress: string) => call<unknown>("POST", `/api/status/${k}?depositAddress=${encodeURIComponent(depositAddress)}`),
    tokens: () => call<unknown[]>("GET", `/api/tokens/${k}`),
  };
};

export type IntentsClient = ReturnType<typeof createIntentsClient>;

/** One address per chain family: every EVM chain shares the `evm` address. */
export const PERSISTENT_CHAINS: { chain: DepositChain; label: string; covers?: string[]; memo?: boolean }[] = [
  { chain: "evm", label: "Ethereum & EVM", covers: ["Ethereum", "Base", "Arbitrum", "Optimism", "Polygon", "BNB Chain", "Avalanche", "Gnosis", "Scroll", "Monad", "Berachain", "X Layer", "Plasma", "Robinhood Chain"] },
  { chain: "btc", label: "Bitcoin" },
  { chain: "tron", label: "Tron" },
  { chain: "sol", label: "Solana" },
  { chain: "ton", label: "TON" },
  { chain: "near", label: "NEAR" },
  { chain: "stellar", label: "Stellar", memo: true },
  { chain: "sui", label: "Sui" },
  { chain: "aptos", label: "Aptos" },
  { chain: "xrp", label: "XRP Ledger" },
  { chain: "doge", label: "Dogecoin" },
  { chain: "zec", label: "Zcash" },
  { chain: "ltc", label: "Litecoin" },
  { chain: "cardano", label: "Cardano" },
  { chain: "starknet", label: "Starknet" },
  { chain: "bch", label: "Bitcoin Cash" },
  { chain: "dash", label: "Dash" },
  { chain: "aleo", label: "Aleo" },
];
