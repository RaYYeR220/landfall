import { Connection, PublicKey } from "@solana/web3.js";
import { JUPITER_LEND, KAMINO, VIRTUAL_ASSETS, VIRTUAL_SHARES } from "./constants";
import { ata, type VaultAddresses } from "./pda";

const key = (d: Buffer, o: number) => new PublicKey(d.subarray(o, o + 32));
const u64 = (d: Buffer, o: number) => d.readBigUInt64LE(o);
const u128 = (d: Buffer, o: number) => d.readBigUInt64LE(o) + (d.readBigUInt64LE(o + 8) << 64n);

export type Vault = {
  admin: PublicKey;
  curator: PublicKey;
  usdcMint: PublicKey;
  shareMint: PublicKey;
  idle: PublicKey;
  kamino: { enabled: boolean; reserve: PublicKey; market: PublicKey; collateralMint: PublicKey; collateralAccount: PublicKey; weightBps: number; cap: bigint; cachedValue: bigint; cachedSlot: bigint };
  jlend: { enabled: boolean; lending: PublicKey; fTokenMint: PublicKey; fTokenAccount: PublicKey; weightBps: number; cap: bigint; cachedValue: bigint; cachedSlot: bigint };
  idleBufferBps: number;
  sweepFee: bigint;
  minSweep: bigint;
  paused: boolean;
  landedTotal: bigint;
  landedCount: bigint;
  redeemedTotal: bigint;
};

/** Borsh layout of the `Vault` account (8-byte discriminator first). */
export const decodeVault = (d: Buffer): Vault => ({
  admin: key(d, 8),
  curator: key(d, 40),
  usdcMint: key(d, 72),
  shareMint: key(d, 104),
  idle: key(d, 136),
  kamino: {
    enabled: d[168] === 1,
    reserve: key(d, 169),
    market: key(d, 201),
    collateralMint: key(d, 233),
    collateralAccount: key(d, 265),
    weightBps: d.readUInt16LE(297),
    cap: u64(d, 299),
    cachedValue: u64(d, 307),
    cachedSlot: u64(d, 315),
  },
  jlend: {
    enabled: d[323] === 1,
    lending: key(d, 324),
    fTokenMint: key(d, 356),
    fTokenAccount: key(d, 388),
    weightBps: d.readUInt16LE(420),
    cap: u64(d, 422),
    cachedValue: u64(d, 430),
    cachedSlot: u64(d, 438),
  },
  idleBufferBps: d.readUInt16LE(446),
  sweepFee: u64(d, 448),
  minSweep: u64(d, 456),
  paused: d[464] === 1,
  landedTotal: u64(d, 465),
  landedCount: u64(d, 473),
  redeemedTotal: u64(d, 481),
});

export type Inbox = { vault: PublicKey; owner: PublicKey; sweptTotal: bigint; sweepCount: bigint; createdSlot: bigint };

export const decodeInbox = (d: Buffer): Inbox => ({
  vault: key(d, 8),
  owner: key(d, 40),
  sweptTotal: u64(d, 72),
  sweepCount: u64(d, 80),
  createdSlot: u64(d, 88),
});

/** Same math as the program (see `strategies/kamino.rs`). */
export const kaminoReserveRate = (d: Buffer) => {
  const sf = 60n;
  const totalSf = (u64(d, 224) << sf) + u128(d, 232) - u128(d, 344) - u128(d, 360) - u128(d, 376);
  return { totalLiquidity: totalSf >> sf, collateralSupply: u64(d, 2592), depositLimit: u64(d, 5016), active: d[4856] === 0 };
};

/** Same math as the program (see `strategies/jlend.rs`). */
export const jlendExchangePrice = (d: Buffer) => d.readBigUInt64LE(115);

const tokenAmount = (d: Buffer | undefined) => (d && d.length >= 72 ? d.readBigUInt64LE(64) : 0n);
const mintSupply = (d: Buffer | undefined) => (d && d.length >= 44 ? d.readBigUInt64LE(36) : 0n);

export type Nav = {
  idle: bigint;
  kamino: bigint;
  jupiterLend: bigint;
  total: bigint;
  shareSupply: bigint;
  /** USDC (base units) per 1 share (1e6 base units), scaled by 1e6. */
  sharePrice1e6: bigint;
  vault: Vault;
};

/** Reads the vault and both strategies in one RPC round-trip. */
export const readNav = async (connection: Connection, v: VaultAddresses): Promise<Nav> => {
  const keys = [v.vault, v.idle, v.shareMint, KAMINO.reserve, ata(v.vault, KAMINO.collateralMint), JUPITER_LEND.lending, ata(v.vault, JUPITER_LEND.fTokenMint)];
  const infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
  const [vaultI, idleI, mintI, reserveI, collI, lendingI, ftI] = infos.map((i) => (i ? Buffer.from(i.data) : undefined));
  if (!vaultI) throw new Error(`vault ${v.vault.toBase58()} not found`);
  const vault = decodeVault(vaultI);
  let kamino = 0n;
  if (reserveI && collI) {
    const r = kaminoReserveRate(reserveI);
    kamino = r.collateralSupply === 0n ? 0n : (tokenAmount(collI) * r.totalLiquidity) / r.collateralSupply;
  }
  let jupiterLend = 0n;
  if (lendingI && ftI) jupiterLend = (tokenAmount(ftI) * jlendExchangePrice(lendingI)) / 1_000_000_000_000n;
  const idle = tokenAmount(idleI);
  const total = idle + kamino + jupiterLend;
  const shareSupply = mintSupply(mintI);
  return { idle, kamino, jupiterLend, total, shareSupply, sharePrice1e6: assetsForShares(1_000_000n, shareSupply, total), vault };
};

export const sharesForAssets = (assets: bigint, supply: bigint, nav: bigint) => (assets * (supply + VIRTUAL_SHARES)) / (nav + VIRTUAL_ASSETS);
export const assetsForShares = (shares: bigint, supply: bigint, nav: bigint) => (shares * (nav + VIRTUAL_ASSETS)) / (supply + VIRTUAL_SHARES);

/**
 * Picks where a redemption's idle shortfall should come from so the
 * transaction stays within one strategy CPI.
 */
export const redeemSourceFor = (nav: Nav, assets: bigint): "idle" | "kamino" | "jupiter-lend" => {
  if (assets <= nav.idle) return "idle";
  const shortfall = assets - nav.idle;
  if (nav.kamino >= shortfall && nav.kamino >= nav.jupiterLend) return "kamino";
  if (nav.jupiterLend >= shortfall) return "jupiter-lend";
  return nav.kamino >= shortfall ? "kamino" : "jupiter-lend";
};

const DISC = {
  reserve: "2bf2ccca1af73b7f",
  market: "f6723262489d1c78",
  lending: "87c75210f983b6f1",
};
const is = (d: Buffer | undefined, disc: string, minLen: number): d is Buffer => !!d && d.length >= minLen && d.subarray(0, 8).toString("hex") === disc;

export type StrategyHealth = {
  kamino: { readable: boolean; active: boolean; emergencyMode: boolean; totalLiquidity: bigint; depositLimit: bigint; headroom: bigint; acceptsDeposits: boolean };
  jupiterLend: { readable: boolean; exchangePrice: bigint };
};

/**
 * Live state of the two strategies, read the way the program reads them.
 * Every condition here is one that makes a direct "bridge, then deposit into
 * the lending protocol" transaction revert. Landfall's landing does not depend
 * on any of them; allocation simply waits.
 */
export const strategyHealth = async (connection: Connection): Promise<StrategyHealth> => {
  const infos = await connection.getMultipleAccountsInfo([KAMINO.reserve, KAMINO.market, JUPITER_LEND.lending], "confirmed");
  const [reserve, market, lending] = infos.map((i) => (i ? Buffer.from(i.data) : undefined));
  const kReadable = is(reserve, DISC.reserve, 5024) && is(market, DISC.market, 123);
  let kamino: StrategyHealth["kamino"] = { readable: false, active: false, emergencyMode: false, totalLiquidity: 0n, depositLimit: 0n, headroom: 0n, acceptsDeposits: false };
  if (kReadable) {
    const r = kaminoReserveRate(reserve);
    const emergencyMode = market[122] !== 0;
    const headroom = r.depositLimit > r.totalLiquidity ? r.depositLimit - r.totalLiquidity : 0n;
    kamino = { readable: true, active: r.active, emergencyMode, totalLiquidity: r.totalLiquidity, depositLimit: r.depositLimit, headroom, acceptsDeposits: r.active && !emergencyMode && headroom > 0n };
  }
  const jReadable = is(lending, DISC.lending, 123);
  return { kamino, jupiterLend: { readable: jReadable, exchangePrice: jReadable ? jlendExchangePrice(lending) : 0n } };
};
