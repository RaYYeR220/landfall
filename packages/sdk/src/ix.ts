import { createHash } from "node:crypto";
import { AccountMeta, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  INSTRUCTIONS_SYSVAR_ID,
  JUPITER_LEND,
  KAMINO,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "./constants.js";
import { ata, inboxAddresses, type VaultAddresses } from "./pda.js";

/** Anchor instruction discriminator: sha256("global:<name>")[0..8]. */
export const discriminator = (name: string): Buffer => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

const u64 = (v: bigint | number): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};
const u16 = (v: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};

const w = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: true });
const r = (pubkey: PublicKey, isSigner = false): AccountMeta => ({ pubkey, isSigner, isWritable: false });

const ix = (v: VaultAddresses, name: string, keys: AccountMeta[], args: Buffer[] = []) =>
  new TransactionInstruction({ programId: v.programId, keys, data: Buffer.concat([discriminator(name), ...args]) });

/** Strategy accounts the program reads to value the vault, in program order. */
export const navAccounts = (v: VaultAddresses): AccountMeta[] => [
  r(KAMINO.reserve),
  r(ata(v.vault, KAMINO.collateralMint)),
  r(JUPITER_LEND.lending),
  r(ata(v.vault, JUPITER_LEND.fTokenMint)),
];

export const createAtaIdempotentIx = (payer: PublicKey, owner: PublicKey, mint: PublicKey) =>
  new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [w(payer, true), w(ata(owner, mint)), r(owner), r(mint), r(SYSTEM_PROGRAM_ID), r(TOKEN_PROGRAM_ID)],
    data: Buffer.from([1]),
  });

/** The landing: `depositor` moves `amount` USDC into the vault, shares go to `owner`. */
export const depositIx = (v: VaultAddresses, depositor: PublicKey, owner: PublicKey, amount: bigint | number) =>
  ix(
    v,
    "deposit",
    [
      r(depositor, true),
      w(ata(depositor, v.usdcMint)),
      r(owner),
      w(ata(owner, v.shareMint)),
      w(v.vault),
      r(v.usdcMint),
      w(v.idle),
      w(v.shareMint),
      r(TOKEN_PROGRAM_ID),
      ...navAccounts(v),
    ],
    [u64(amount)],
  );

export const openInboxIx = (v: VaultAddresses, payer: PublicKey, owner: PublicKey) => {
  const a = inboxAddresses(v, owner);
  return ix(v, "open_inbox", [
    w(payer, true),
    r(v.vault),
    r(v.usdcMint),
    r(owner),
    w(a.inbox),
    w(a.inboxUsdc),
    r(TOKEN_PROGRAM_ID),
    r(ASSOCIATED_TOKEN_PROGRAM_ID),
    r(SYSTEM_PROGRAM_ID),
  ]);
};

export const sweepInboxIx = (v: VaultAddresses, keeper: PublicKey, owner: PublicKey) => {
  const a = inboxAddresses(v, owner);
  return ix(v, "sweep_inbox", [
    w(keeper, true),
    w(ata(keeper, v.usdcMint)),
    w(v.vault),
    r(v.usdcMint),
    w(a.inbox),
    w(a.inboxUsdc),
    r(owner),
    w(a.ownerShares),
    w(v.idle),
    w(v.shareMint),
    r(TOKEN_PROGRAM_ID),
    r(ASSOCIATED_TOKEN_PROGRAM_ID),
    r(SYSTEM_PROGRAM_ID),
    ...navAccounts(v),
  ]);
};

export const refreshReserveIx = () =>
  new TransactionInstruction({
    programId: KAMINO.program,
    keys: [w(KAMINO.reserve), r(KAMINO.market), r(KAMINO.program), r(KAMINO.program), r(KAMINO.program), r(KAMINO.scopePrices)],
    data: KAMINO.refreshReserveDiscriminator,
  });

const kaminoCpi = (v: VaultAddresses): AccountMeta[] => [
  w(KAMINO.reserve),
  w(ata(v.vault, KAMINO.collateralMint)),
  r(KAMINO.market),
  r(KAMINO.marketAuthority),
  w(KAMINO.liquiditySupply),
  w(KAMINO.collateralMint),
  r(INSTRUCTIONS_SYSVAR_ID),
  r(KAMINO.program),
];

const jlendCpi = (v: VaultAddresses): AccountMeta[] => [
  w(JUPITER_LEND.lending),
  w(ata(v.vault, JUPITER_LEND.fTokenMint)),
  w(JUPITER_LEND.fTokenMint),
  r(JUPITER_LEND.lendingAdmin),
  w(JUPITER_LEND.supplyTokenReservesLiquidity),
  w(JUPITER_LEND.lendingSupplyPositionOnLiquidity),
  r(JUPITER_LEND.rateModel),
  w(JUPITER_LEND.liquidityVault),
  w(JUPITER_LEND.claimAccount),
  w(JUPITER_LEND.liquidity),
  r(JUPITER_LEND.liquidityProgram),
  r(JUPITER_LEND.rewardsRateModel),
  r(JUPITER_LEND.program),
  r(ASSOCIATED_TOKEN_PROGRAM_ID),
  r(SYSTEM_PROGRAM_ID),
];

/** `[refresh_reserve, allocate_kamino]` — permissionless. */
export const allocateKaminoIxs = (v: VaultAddresses, keeper: PublicKey, amount: bigint | number) => [
  refreshReserveIx(),
  ix(
    v,
    "allocate_kamino",
    [
      r(keeper, true),
      w(v.vault),
      r(v.usdcMint),
      w(v.idle),
      ...kaminoCpi(v),
      r(JUPITER_LEND.lending),
      r(ata(v.vault, JUPITER_LEND.fTokenMint)),
      r(TOKEN_PROGRAM_ID),
    ],
    [u64(amount)],
  ),
];

export const allocateJlendIx = (v: VaultAddresses, keeper: PublicKey, amount: bigint | number) =>
  ix(
    v,
    "allocate_jlend",
    [
      r(keeper, true),
      w(v.vault),
      r(v.usdcMint),
      w(v.idle),
      ...jlendCpi(v),
      r(KAMINO.reserve),
      r(ata(v.vault, KAMINO.collateralMint)),
      r(TOKEN_PROGRAM_ID),
    ],
    [u64(amount)],
  );

export const syncNavIx = (v: VaultAddresses) =>
  ix(v, "sync_nav", [w(v.vault), r(v.idle), ...navAccounts(v)]);

const redeemBase = (v: VaultAddresses, owner: PublicKey, destination: PublicKey): AccountMeta[] => [
  r(owner, true),
  w(ata(owner, v.shareMint)),
  w(destination),
  w(v.vault),
  r(v.usdcMint),
  w(v.idle),
  w(v.shareMint),
  ...navAccounts(v),
  r(TOKEN_PROGRAM_ID),
];

export type RedeemSource = "idle" | "kamino" | "jupiter-lend";

/**
 * Burn `shares` and pay USDC to `destination` (any USDC token account).
 * `source` picks where an idle shortfall is pulled from; Kamino needs a
 * `refresh_reserve` right before, so this returns an instruction list.
 */
export const redeemIxs = (
  v: VaultAddresses,
  owner: PublicKey,
  destination: PublicKey,
  shares: bigint | number,
  minOut: bigint | number,
  source: RedeemSource = "idle",
): TransactionInstruction[] => {
  const args = [u64(shares), u64(minOut)];
  const base = redeemBase(v, owner, destination);
  if (source === "kamino") return [refreshReserveIx(), ix(v, "redeem_via_kamino", [...base, ...kaminoCpi(v)], args)];
  if (source === "jupiter-lend") return [ix(v, "redeem_via_jlend", [...base, ...jlendCpi(v)], args)];
  return [ix(v, "redeem", base, args)];
};

// ---- admin (curator / admin keys) ----

export const initVaultIx = (
  v: VaultAddresses,
  admin: PublicKey,
  p: { curator: PublicKey; idleBufferBps: number; sweepFee: bigint; minSweep: bigint; seedAmount: bigint },
) =>
  ix(
    v,
    "init_vault",
    [
      w(admin, true),
      r(v.usdcMint),
      w(v.vault),
      w(v.shareMint),
      w(v.idle),
      w(v.deadShares),
      w(ata(admin, v.usdcMint)),
      r(TOKEN_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SYSTEM_PROGRAM_ID),
    ],
    [p.curator.toBuffer(), u16(p.idleBufferBps), u64(p.sweepFee), u64(p.minSweep), u64(p.seedAmount)],
  );

export const configureKaminoIx = (v: VaultAddresses, admin: PublicKey, enabled: boolean) =>
  ix(
    v,
    "configure_kamino",
    [
      w(admin, true),
      w(v.vault),
      r(v.usdcMint),
      r(KAMINO.reserve),
      r(KAMINO.collateralMint),
      w(ata(v.vault, KAMINO.collateralMint)),
      r(TOKEN_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SYSTEM_PROGRAM_ID),
    ],
    [Buffer.from([enabled ? 1 : 0])],
  );

export const configureJlendIx = (v: VaultAddresses, admin: PublicKey, enabled: boolean) =>
  ix(
    v,
    "configure_jlend",
    [
      w(admin, true),
      w(v.vault),
      r(v.usdcMint),
      r(JUPITER_LEND.lending),
      r(JUPITER_LEND.fTokenMint),
      w(ata(v.vault, JUPITER_LEND.fTokenMint)),
      r(TOKEN_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SYSTEM_PROGRAM_ID),
    ],
    [Buffer.from([enabled ? 1 : 0])],
  );

export const setWeightsIx = (v: VaultAddresses, curator: PublicKey, kaminoBps: number, jlendBps: number, kaminoCap: bigint, jlendCap: bigint) =>
  ix(v, "set_weights", [r(curator, true), w(v.vault)], [u16(kaminoBps), u16(jlendBps), u64(kaminoCap), u64(jlendCap)]);

export const setPausedIx = (v: VaultAddresses, curator: PublicKey, paused: boolean) =>
  ix(v, "set_paused", [r(curator, true), w(v.vault)], [Buffer.from([paused ? 1 : 0])]);

export const setParamsIx = (v: VaultAddresses, curator: PublicKey, idleBufferBps: number, sweepFee: bigint, minSweep: bigint) =>
  ix(v, "set_params", [r(curator, true), w(v.vault)], [u16(idleBufferBps), u64(sweepFee), u64(minSweep)]);
