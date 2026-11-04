/**
 * Intents Connect steps for Landfall (Solana destination).
 *
 * The user's Intents Connect Solana intermediary is the share owner, so an
 * EVM / NEAR / Stellar wallet holds vault shares on Solana and controls them
 * with its own signature. All steps use `{INTERMEDIARY}` for that account;
 * token accounts derived from it are passed as resolved addresses, as the
 * Intents Connect docs require.
 */
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { SolanaStep } from "@aurora-is-near/intents-connect";
import { BACKEND_PLACEHOLDERS } from "@aurora-is-near/intents-connect";
import { AURORA_ASSETS, TOKEN_PROGRAM_ID, USDC_DECIMALS } from "./constants.js";
import { createAtaIdempotentIx, depositIx, discriminator, redeemIxs, type RedeemSource } from "./ix.js";
import { ata, type VaultAddresses } from "./pda.js";

/** Converts instructions to Intents Connect steps, swapping the intermediary for its placeholder. */
export const toSteps = (ixs: TransactionInstruction[], intermediary: PublicKey, names: string[] = []): SolanaStep[] =>
  ixs.map((ix, i) => ({
    programId: ix.programId.toBase58(),
    discriminator: Buffer.from(ix.data).toString("hex"),
    args: [],
    accounts: ix.keys.map((k) => ({
      pubkey: k.pubkey.equals(intermediary) ? BACKEND_PLACEHOLDERS.intermediary : k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    ...(names[i] ? { metadata: { name: names[i] } } : {}),
  }));

/** SPL TransferChecked step (opcode 12). */
export const transferCheckedStep = (from: string, to: string, authority: string, amount: string): SolanaStep => ({
  programId: TOKEN_PROGRAM_ID.toBase58(),
  discriminator: "0c",
  args: [
    { name: "amount", type: "u64", value: amount },
    { name: "decimals", type: "u8", value: String(USDC_DECIMALS) },
  ],
  accounts: [
    { pubkey: from, isSigner: false, isWritable: true },
    { pubkey: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", isSigner: false, isWritable: false },
    { pubkey: to, isSigner: false, isWritable: true },
    { pubkey: authority, isSigner: authority === BACKEND_PLACEHOLDERS.intermediary, isWritable: false },
  ],
  metadata: { name: "Transfer USDC" },
});

/**
 * Bridge-in landing: whatever arrives in the intermediary (`{MIN_AMOUNT_OUT}`,
 * already net of the network fee) is deposited into the vault in the same
 * transaction. Shares are minted to `owner` (default: the intermediary).
 */
export const bridgeInDepositSteps = (v: VaultAddresses, intermediary: PublicKey, owner: PublicKey = intermediary): SolanaStep[] => {
  const createShares = createAtaIdempotentIx(intermediary, owner, v.shareMint);
  const dep = depositIx(v, intermediary, owner, 0);
  const [createStep] = toSteps([createShares], intermediary, ["Open share account"]);
  const [depositStep] = toSteps([dep], intermediary);
  return [
    createStep,
    {
      ...depositStep,
      discriminator: discriminator("deposit").toString("hex"),
      args: [{ name: "amount", type: "u64", value: BACKEND_PLACEHOLDERS.minAmountOut }],
      metadata: { name: "Land in Landfall vault", description: "Deposit the bridged USDC and mint lfUSDC shares" },
    },
  ];
};

/**
 * Steps-only "finish into vault": deposit USDC already sitting in the
 * intermediary (a failed or expired execution's leftovers). `amount` must
 * leave the network fee behind (size it with a dry run).
 */
export const finishIntoVaultSteps = (v: VaultAddresses, intermediary: PublicKey, amount: bigint): SolanaStep[] => {
  const ixs = [createAtaIdempotentIx(intermediary, intermediary, v.shareMint), depositIx(v, intermediary, intermediary, amount)];
  return toSteps(ixs, intermediary, ["Open share account", "Land in Landfall vault"]);
};

/** Redeem shares into the intermediary's USDC account (first half of every withdrawal). */
export const redeemSteps = (v: VaultAddresses, intermediary: PublicKey, shares: bigint, minOut: bigint, source: RedeemSource): SolanaStep[] => {
  const ixs = redeemIxs(v, intermediary, ata(intermediary, v.usdcMint), shares, minOut, source);
  return toSteps(ixs, intermediary, ixs.length === 2 ? ["Refresh Kamino reserve", "Redeem lfUSDC"] : ["Redeem lfUSDC"]);
};

/**
 * Out-operation withdrawal to any chain: redeem, then the producer transfer to
 * `{DEPOSIT_ADDRESS}` that the service bridges out. For EXACT_INPUT the
 * service overwrites the producer amount with `quote.amount − networkFee`.
 */
export const withdrawAnywhereSteps = (
  v: VaultAddresses,
  intermediary: PublicKey,
  shares: bigint,
  minOut: bigint,
  source: RedeemSource,
): SolanaStep[] => [
  ...redeemSteps(v, intermediary, shares, minOut, source),
  transferCheckedStep(ata(intermediary, v.usdcMint).toBase58(), BACKEND_PLACEHOLDERS.depositAddress, BACKEND_PLACEHOLDERS.intermediary, minOut.toString()),
];

/** Steps-only withdrawal to a Solana address (USDC lands in its ATA). */
export const withdrawToSolanaSteps = (
  v: VaultAddresses,
  intermediary: PublicKey,
  recipient: PublicKey,
  shares: bigint,
  minOut: bigint,
  source: RedeemSource,
  sendAmount: bigint,
): SolanaStep[] => [
  ...redeemSteps(v, intermediary, shares, minOut, source),
  ...toSteps([createAtaIdempotentIx(intermediary, recipient, v.usdcMint)], intermediary, ["Open recipient USDC account"]),
  transferCheckedStep(ata(intermediary, v.usdcMint).toBase58(), ata(recipient, v.usdcMint).toBase58(), BACKEND_PLACEHOLDERS.intermediary, sendAmount.toString()),
];

/** Destination asset of every Landfall bridge-in. */
export const LANDFALL_DESTINATION = { chain: "sol", assetId: AURORA_ASSETS.solanaUsdc, tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } as const;
