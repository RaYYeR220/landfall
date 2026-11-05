/**
 * Source chains for the landing page: the vortex arms in the hero and the
 * address capsule below it. Addresses are sample-shaped strings only (grouped,
 * truncated with an ellipsis, always tagged "sample") and never real addresses.
 * Timings are typical arrival, labelled illustrative.
 */

export type Group = "sol" | "evm" | "ton" | "trx" | "btc" | "var";

/** T = on-screen seconds from rim to core (Bitcoin's ~14 min plays in 14 s). */
export const GROUPS: Record<Group, { time: string | null; assets: string | null; T: number }> = {
  sol: { time: "~25 s", assets: "SOL, USDC, USDT", T: 2.6 },
  evm: { time: "< 1 min", assets: null, T: 3.4 },
  ton: { time: "~1 min", assets: "TON, USDT", T: 3.8 },
  trx: { time: "~1–2 min", assets: "USDT, TRX", T: 4.6 },
  btc: { time: "~14 min", assets: "BTC", T: 14 },
  var: { time: null, assets: null, T: 6 },
};

/** A permanent deposit address (one per network; every EVM chain shares one). */
export type DepositAddress = {
  key: string;
  /** Chip / header name. */
  name: string;
  chipSub?: string;
  /** Six 4-character groups. Sample only. */
  groups: [string, string, string, string, string, string];
  /** Transfer requirement, as the address shows it. */
  req: string;
  memo?: string;
  time: string | null;
  /** Rail "Detected" line. */
  detected: string;
  /** Rail replay length in ms (relative pace only). */
  ms: number;
};

const EVM_GROUPS: DepositAddress["groups"] = ["0x4f", "2a9c", "1e7b", "30d8", "a6c2", "91fe"];

export const ADDRESSES: DepositAddress[] = [
  { key: "trx", name: "Tron", groups: ["T9Ld", "Xw2q", "8kWp", "rV2x", "bN4h", "Pz7e"], req: "Send only USDT or TRX from the Tron network. Minimum $2.", time: "~1–2 min", detected: "USDT on Tron", ms: 2600 },
  { key: "btc", name: "Bitcoin", groups: ["bc1q", "8x2t", "m9fd", "w4p0", "3kje", "7mu0"], req: "Send only BTC from the Bitcoin network. Minimum $1.", time: "~14 min", detected: "BTC on Bitcoin", ms: 3400 },
  {
    key: "evm", name: "EVM", chipSub: "7 chains", groups: EVM_GROUPS,
    req: "One address for Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain and Avalanche. Minimum $1.",
    time: "< 1 min", detected: "USDC on Base", ms: 1900,
  },
  { key: "sol", name: "Solana", groups: ["7Hk2", "pQ9w", "Ve3n", "Xm4t", "Ra8L", "c5Ju"], req: "Send SOL, USDC or USDT from the Solana network. Minimum $1.", time: "~25 s", detected: "USDC on Solana", ms: 1500 },
  { key: "ton", name: "TON", groups: ["UQAv", "3k9T", "hW7c", "pX2m", "Q8sw", "Lr4d"], req: "Send only TON or USDT from the TON network. Minimum $1.", time: "~1 min", detected: "USDT on TON", ms: 2300 },
  { key: "xlm", name: "Stellar", groups: ["GBX7", "4KQD", "R2NA", "M2WN", "6TQA", "HJ5E"], memo: "4417 2093", req: "Send only from the Stellar network, and include the memo. Minimum $1.", time: null, detected: "Deposit on Stellar", ms: 2300 },
  { key: "near", name: "NEAR", groups: ["9e1c", "4b7a", "02fd", "6a3e", "c81b", "57d0"], req: "Send only from the NEAR network. Minimum $1.", time: null, detected: "Deposit on NEAR", ms: 2300 },
  { key: "sui", name: "Sui", groups: ["0x7d", "3b1e", "9c40", "a2f6", "18de", "5c0b"], req: "Send only from the Sui network. Minimum $1.", time: null, detected: "Deposit on Sui", ms: 2300 },
  { key: "apt", name: "Aptos", groups: ["0x2c", "8e5a", "d013", "7bf4", "96a1", "e3c7"], req: "Send only from the Aptos network. Minimum $1.", time: null, detected: "Deposit on Aptos", ms: 2300 },
  { key: "xrp", name: "XRP", groups: ["rN7q", "4Ld2", "hY8x", "Kp3s", "Wm6v", "Tz9b"], req: "Send only from the XRP Ledger. Minimum $1.", time: null, detected: "Deposit on XRP", ms: 2300 },
  { key: "doge", name: "Dogecoin", groups: ["DH5y", "aKr2", "x8Qw", "4mPz", "Lt7e", "9vNc"], req: "Send only DOGE from the Dogecoin network. Minimum $1.", time: null, detected: "DOGE on Dogecoin", ms: 2300 },
  { key: "zec", name: "Zcash", groups: ["t1Vb", "3kQe", "7wXp", "2mRz", "9hLd", "4sNa"], req: "Send only ZEC from the Zcash network. Minimum $1.", time: null, detected: "ZEC on Zcash", ms: 2300 },
  { key: "ltc", name: "Litecoin", groups: ["ltc1", "q7ka", "3m9x", "w2d4", "p8fe", "6tj0"], req: "Send only LTC from the Litecoin network. Minimum $1.", time: null, detected: "LTC on Litecoin", ms: 2300 },
  { key: "ada", name: "Cardano", groups: ["addr", "1qx8", "v4k2", "7wze", "3l0p", "f9s6"], req: "Send only from the Cardano network. Minimum $1.", time: null, detected: "Deposit on Cardano", ms: 2300 },
  { key: "strk", name: "Starknet", groups: ["0x04", "1d7e", "b39a", "c52f", "8a06", "e1b4"], req: "Send only from the Starknet network. Minimum $1.", time: null, detected: "Deposit on Starknet", ms: 2300 },
  {
    key: "cex", name: "Exchange", groups: EVM_GROUPS,
    req: "Withdrawing from an exchange? Pick Ethereum, Base or Arbitrum as the network. Minimum $1.",
    time: null, detected: "USDC from an exchange", ms: 2100,
  },
];

export const addressByKey = (key: string) => ADDRESSES.find((a) => a.key === key) ?? ADDRESSES[0];

/** Full form: 3 groups … 3 groups. Compact form: 2 … 2. Same length within each form. */
export const fullText = (g: DepositAddress["groups"]) => `${g[0]} ${g[1]} ${g[2]} … ${g[3]} ${g[4]} ${g[5]}`;
export const compactText = (g: DepositAddress["groups"]) => `${g[0]} ${g[1]} … ${g[4]} ${g[5]}`;

/** A vortex arm. `addr` keys into ADDRESSES. */
export type Arm = { id: string; name: string; group: Group; addr: string };

const evm = (id: string, name: string): Arm => ({ id, name, group: "evm", addr: "evm" });

/** Around the ellipse: left side front → back, then right side front → back. */
export const LEFT: Arm[] = [
  { id: "trx", name: "Tron", group: "trx", addr: "trx" },
  evm("base", "Base"),
  evm("eth", "Ethereum"),
  evm("arb", "Arbitrum"),
  evm("op", "Optimism"),
  evm("pol", "Polygon"),
  evm("bnb", "BNB Chain"),
  evm("avax", "Avalanche"),
  { id: "strk", name: "Starknet", group: "var", addr: "strk" },
  { id: "sui", name: "Sui", group: "var", addr: "sui" },
  { id: "apt", name: "Aptos", group: "var", addr: "apt" },
];
export const RIGHT: Arm[] = [
  { id: "btc", name: "Bitcoin", group: "btc", addr: "btc" },
  { id: "sol", name: "Solana", group: "sol", addr: "sol" },
  { id: "ton", name: "TON", group: "ton", addr: "ton" },
  { id: "xrp", name: "XRP", group: "var", addr: "xrp" },
  { id: "xlm", name: "Stellar", group: "var", addr: "xlm" },
  { id: "near", name: "NEAR", group: "var", addr: "near" },
  { id: "doge", name: "Dogecoin", group: "var", addr: "doge" },
  { id: "ltc", name: "Litecoin", group: "var", addr: "ltc" },
  { id: "zec", name: "Zcash", group: "var", addr: "zec" },
  { id: "ada", name: "Cardano", group: "var", addr: "ada" },
  { id: "cex", name: "Exchange", group: "var", addr: "cex" },
];
export const ARMS = [...LEFT, ...RIGHT];

/** What the hero readout shows for a lit arm. EVM arms share one address. */
export const readoutFor = (armId: string) => {
  const arm = ARMS.find((a) => a.id === armId) ?? ARMS[0];
  const a = addressByKey(arm.addr);
  if (arm.group === "evm") {
    return { ...a, name: arm.name, req: `Send from ${arm.name} or any EVM chain. Same address on all seven. Minimum $1.` };
  }
  if (arm.id === "cex") return { ...a, name: "Exchange withdrawal", req: "Withdraw from an exchange on Ethereum, Base or Arbitrum. Minimum $1." };
  if (a.memo) return { ...a, req: `Send only from the Stellar network, with memo ${a.memo}. Minimum $1.` };
  return a;
};
