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
 * small USDC deposit so anyone can watch a cross-chain landing without a
 * wallet, funds or install. Two routes, both mainnet:
 *  - `address`: plain USDC transfer to the demo owner's persistent EVM address
 *    (no signature) → Aurora → inbox → keeper sweep → shares.
 *  - `connect`: Intents Connect bridge-in signed by the demo wallet whose
 *    steps call `landfall.deposit` on arrival (one signature).
 */

export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const BASE_USDC_ASSET = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

const account = () => {
  const pk = process.env.DEMO_EVM_PRIVATE_KEY;
  if (!pk) throw new Error("DEMO_EVM_PRIVATE_KEY is not configured");
  return privateKeyToAccount(pk as Hex);
};
const transport = () => http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org");
const amount = () => BigInt(Math.round(Number(process.env.DEMO_FIRE_AMOUNT_USDC ?? "1") * 1e6));

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
  const bal = await pub.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account().address] });
  if (bal < amount()) throw Object.assign(new Error("the demo budget is spent for today"), { status: 429 });
};

const sendUsdc = async (to: `0x${string}`) => {
  const wallet = createWalletClient({ account: account(), chain: base, transport: transport() });
  const pub = createPublicClient({ chain: base, transport: transport() });
  const hash = await wallet.sendTransaction({ to: BASE_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount()] }) });
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
  const txHash = await sendUsdc(evmAddr as `0x${string}`);
  return { route: "address" as const, from: evm, depositAddress: evmAddr, owner: owner.toBase58(), inbox: book.inbox, amount: amount().toString(), txHash };
};

export const fireViaConnect = async () => {
  await guard();
  const acct = account();
  const { evm, owner } = await demoIdentity();
  const api = connectApi();
  const exec = await api.createExecution(evm, {
    version: "1.0",
    type: "solana",
    quote: { originAsset: BASE_USDC_ASSET, destinationAsset: AURORA_ASSETS.solanaUsdc, amount: amount().toString(), swapType: "EXACT_INPUT", slippageTolerance: 100 },
    steps: bridgeInDepositSteps(vault, owner),
    metadata: { title: "Land in Landfall vault", intent: "landfall_deposit", url: "https://landfall.app" },
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
  const txHash = await sendUsdc(depositAddress);
  await api.recordDeposit({ txHash, depositAddress });
  return { route: "connect" as const, from: evm, executionId: exec.id, depositAddress, owner: owner.toBase58(), amount: amount().toString(), txHash };
};
