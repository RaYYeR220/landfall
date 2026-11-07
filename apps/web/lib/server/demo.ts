import "server-only";
import { PublicKey } from "@solana/web3.js";
import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { signIntentsConnectPayload } from "@aurora-is-near/intents-connect";
import { AURORA_ASSETS, bridgeInDepositSteps } from "@landfall/sdk";
import { addressBook } from "./addresses";
import { connectApi, vault } from "./env";

/**
 * "Fire a live deposit": a spend-capped server wallet on Base sends a real,
 * small deposit (ETH by default) so anyone can watch a cross-chain landing without a
 * wallet, funds or install. Two routes, both mainnet:
 *  - `address`: plain transfer to the demo owner's persistent EVM address
 *    (no signature) → Aurora → inbox → keeper sweep → shares.
 *  - `connect`: Intents Connect bridge-in signed by the demo wallet whose
 *    steps call `landfall.deposit` on arrival (one signature).
 */

export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const BASE_USDC_ASSET = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
export const BASE_ETH_ASSET = "nep141:base.omft.near";

const account = () => {
  const pk = process.env.DEMO_EVM_PRIVATE_KEY;
  if (!pk) throw new Error("DEMO_EVM_PRIVATE_KEY is not configured");
  return privateKeyToAccount(pk as Hex);
};
const transport = () => http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org");

/**
 * What the demo sends: native ETH by default (Aurora swaps it to USDC on the
 * way, so the demo also shows the built-in swap), or USDC.
 */
const asset = () => (process.env.DEMO_FIRE_ASSET === "usdc" ? "usdc" : "eth");
const amount = () =>
  asset() === "eth"
    ? BigInt(Math.round(Number(process.env.DEMO_FIRE_AMOUNT_ETH ?? "0.0006") * 1e18))
    : BigInt(Math.round(Number(process.env.DEMO_FIRE_AMOUNT_USDC ?? "1") * 1e6));
const display = () => (asset() === "eth" ? `${Number(amount()) / 1e18} ETH` : `${Number(amount()) / 1e6} USDC`);
export const demoBudget = () => ({ enabled: process.env.DEMO_ENABLED === "true", asset: asset(), display: display() });
/** ETH kept back for gas on Base. */
const GAS_RESERVE = 20_000_000_000_000n; // 0.00002 ETH; a Base transfer costs well under that

let lastFire = 0;
const COOLDOWN_MS = 45_000;

/**
 * Bounds: one fire per cooldown (slot reserved before any await), the
 * feature flag, and the wallet balance itself (the wallet only ever holds the
 * demo budget). Fired funds land in the demo identity's own vault position.
 */
const guard = async () => {
  if (process.env.DEMO_ENABLED !== "true") throw Object.assign(new Error("live demo is switched off"), { status: 403 });
  const now = Date.now();
  if (now - lastFire < COOLDOWN_MS) throw Object.assign(new Error(`a live deposit was fired ${Math.round((now - lastFire) / 1000)} s ago, try again shortly`), { status: 429 });
  lastFire = now;
  const pub = createPublicClient({ chain: base, transport: transport() });
  const enough =
    asset() === "eth"
      ? (await pub.getBalance({ address: account().address })) >= amount() + GAS_RESERVE
      : (await pub.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account().address] })) >= amount();
  if (!enough) throw Object.assign(new Error("the demo budget is spent for today"), { status: 429 });
};

const send = async (to: `0x${string}`) => {
  const wallet = createWalletClient({ account: account(), chain: base, transport: transport() });
  const pub = createPublicClient({ chain: base, transport: transport() });
  const hash =
    asset() === "eth"
      ? await wallet.sendTransaction({ to, value: amount() })
      : await wallet.sendTransaction({ to: BASE_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount()] }) });
  await pub.waitForTransactionReceipt({ hash, confirmations: 1 });
  return hash;
};

/** The demo identity: the demo wallet's own Intents Connect Solana intermediary. */
export const demoIdentity = async () => {
  const evm = account().address;
  const inter = await connectApi().getIntermediary(evm);
  if (!inter.solana) throw new Error("Solana intermediary unavailable");
  return { evm, owner: new PublicKey(inter.solana) };
};

export const fireViaAddress = async () => {
  await guard();
  const { evm, owner } = await demoIdentity();
  const book = await addressBook(owner, { allowCreate: true });
  const evmAddr = book.chains.find((c) => c.chain === "evm")?.address;
  if (!evmAddr) throw new Error(book.status === "pending-approval" ? "persistent addresses are not enabled for this key yet" : "no EVM deposit address");
  const txHash = await send(evmAddr as `0x${string}`);
  return { route: "address" as const, from: evm, depositAddress: evmAddr, owner: owner.toBase58(), inbox: book.inbox, amount: amount().toString(), display: display(), txHash };
};

export const fireViaConnect = async () => {
  await guard();
  const acct = account();
  const { evm, owner } = await demoIdentity();
  const api = connectApi();
  const exec = await api.createExecution(evm, {
    version: "1.0",
    type: "solana",
    quote: { originAsset: asset() === "eth" ? BASE_ETH_ASSET : BASE_USDC_ASSET, destinationAsset: AURORA_ASSETS.solanaUsdc, amount: amount().toString(), swapType: "EXACT_INPUT", slippageTolerance: 100 },
    steps: bridgeInDepositSteps(vault, owner),
    metadata: { title: "Land in Landfall vault", intent: "landfall_deposit" },
    dry: false,
  });
  const provider = {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct.address];
      if (method === "personal_sign") return acct.signMessage({ message: (params as [string])[0] });
      throw new Error(`unsupported ${method}`);
    },
  };
  const details = (exec as { details?: { payload: Parameters<typeof signIntentsConnectPayload>[0]["payload"] } }).details!;
  const envelope = await signIntentsConnectPayload({ payload: details.payload, standard: "erc191", address: acct.address, providers: { evm: provider } as never });
  await api.submitSignature(evm, { ...envelope, executionId: exec.id });
  const depositAddress = exec.quote?.depositAddress as `0x${string}`;
  const txHash = await send(depositAddress);
  await api.recordDeposit({ txHash, depositAddress });
  return { route: "connect" as const, from: evm, executionId: exec.id, depositAddress, owner: owner.toBase58(), amount: amount().toString(), display: display(), txHash };
};
