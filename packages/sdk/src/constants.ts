import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

export const LANDFALL_PROGRAM_ID = new PublicKey("12pHvK6FYFHP748kom4F3AbKcymKGVN2r9n1GtX3zdyZ");

export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const USDC_DECIMALS = 6;
export const SHARE_DECIMALS = 6;

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
export const INSTRUCTIONS_SYSVAR_ID = new PublicKey("Sysvar1nstructions1111111111111111111111111");

export const SEEDS = {
  vault: Buffer.from("vault"),
  shares: Buffer.from("shares"),
  inbox: Buffer.from("inbox"),
} as const;

/** Kamino main market, USDC reserve (Solana mainnet). */
export const KAMINO = {
  program: new PublicKey("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD"),
  market: new PublicKey("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF"),
  marketAuthority: new PublicKey("9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo"),
  reserve: new PublicKey("D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59"),
  liquiditySupply: new PublicKey("Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6"),
  collateralMint: new PublicKey("B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D"),
  scopePrices: new PublicKey("3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH"),
  refreshReserveDiscriminator: Buffer.from("02da8aeb4fc91966", "hex"),
} as const;

/** Jupiter Lend Earn, USDC market (Solana mainnet). */
export const JUPITER_LEND = {
  program: new PublicKey("jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9"),
  liquidityProgram: new PublicKey("jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC"),
  lendingAdmin: new PublicKey("5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6"),
  lending: new PublicKey("2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ"),
  fTokenMint: new PublicKey("9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D"),
  supplyTokenReservesLiquidity: new PublicKey("94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu"),
  lendingSupplyPositionOnLiquidity: new PublicKey("Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF"),
  rateModel: new PublicKey("5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688"),
  liquidityVault: new PublicKey("BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB"),
  liquidity: new PublicKey("7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z"),
  rewardsRateModel: new PublicKey("5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd"),
  claimAccount: new PublicKey("HN1r4VfkDn53xQQfeGDYrNuDKFdemAhZsHYRwBrFhsW"),
} as const;

/** Aurora Intents asset ids (1Click) for the destination. */
export const AURORA_ASSETS = {
  solanaUsdc: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near",
} as const;

export const AURORA = {
  connectApi: "https://intents-connect-alpha-api.aurora.dev",
  intentsApi: "https://intents-api.aurora.dev",
} as const;

export const VIRTUAL_SHARES = 1_000_000n;
export const VIRTUAL_ASSETS = 1_000_000n;
