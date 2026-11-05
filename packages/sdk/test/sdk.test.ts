import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { guards } from "@aurora-is-near/intents-connect";
import {
  assetsForShares,
  bridgeInDepositSteps,
  discriminator,
  finishIntoVaultSteps,
  inboxPda,
  LANDFALL_PROGRAM_ID,
  redeemSourceFor,
  sharesForAssets,
  USDC_MINT,
  vaultAddresses,
  withdrawAnywhereSteps,
  withdrawToSolanaSteps,
} from "../src/index";

const v = vaultAddresses();
const intermediary = new PublicKey("FTyLUa5jYKqKfgixknDjDZ32RHWx4x9eqgrKnpwLE9cw");

describe("addresses", () => {
  it("derives the vault the program derives", () => {
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from("vault"), USDC_MINT.toBuffer()], LANDFALL_PROGRAM_ID);
    expect(v.vault.equals(expected)).toBe(true);
  });
  it("gives every owner a distinct inbox", () => {
    const a = inboxPda(v.vault, Keypair.generate().publicKey);
    const b = inboxPda(v.vault, Keypair.generate().publicKey);
    expect(a.equals(b)).toBe(false);
    expect(PublicKey.isOnCurve(a.toBytes())).toBe(false);
  });
});

describe("discriminators", () => {
  it("match Anchor's sha256('global:<name>')", () => {
    expect(discriminator("deposit").length).toBe(8);
    expect(discriminator("deposit").equals(discriminator("sweep_inbox"))).toBe(false);
  });
});

describe("share math mirrors the program", () => {
  it("first deposit is 1:1", () => {
    expect(sharesForAssets(5_000_000n, 0n, 0n)).toBe(5_000_000n);
  });
  it("round trip never pays more than deposited", () => {
    const s = sharesForAssets(7_777_777n, 1_234_567_890n, 1_300_000_000n);
    const back = assetsForShares(s, 1_234_567_890n + s, 1_300_000_000n + 7_777_777n);
    expect(back <= 7_777_777n).toBe(true);
  });
});

const legal = (steps: Parameters<typeof guards.solanaStepsAreLegal>[0]) => {
  guards.stepsRequiredForRealCreate(steps);
  guards.solanaStepsAreLegal(steps, []);
};

describe("Intents Connect steps", () => {
  it("bridge-in landing passes Aurora's step guards and uses {MIN_AMOUNT_OUT}", () => {
    const steps = bridgeInDepositSteps(v, intermediary);
    expect(() => legal(steps)).not.toThrow();
    const dep = steps[1];
    expect(dep.programId).toBe(LANDFALL_PROGRAM_ID.toBase58());
    expect(dep.args).toEqual([{ name: "amount", type: "u64", value: "{MIN_AMOUNT_OUT}" }]);
    // only the intermediary signs; it appears as the placeholder
    const signers = steps.flatMap((s) => s.accounts.filter((a) => a.isSigner).map((a) => a.pubkey));
    expect(new Set(signers)).toEqual(new Set(["{INTERMEDIARY}"]));
    // the share account is opened first (funder = intermediary → reassigned to fee payer)
    expect(steps[0].programId).toBe("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
    // touches the destination token (USDC mint)
    expect(dep.accounts.some((a) => a.pubkey === USDC_MINT.toBase58())).toBe(true);
  });

  it("finish-into-vault, withdraw-anywhere and withdraw-to-Solana steps are legal", () => {
    expect(() => legal(finishIntoVaultSteps(v, intermediary, 1_000_000n))).not.toThrow();
    const out = withdrawAnywhereSteps(v, intermediary, 5_000_000n, 4_900_000n, "kamino");
    // the SDK's client guard predates the out-operation placeholder; check the rest of the rules
    expect(() => legal(out.slice(0, -1))).not.toThrow();
    expect(out.at(-1)!.accounts[2].pubkey).toBe("{DEPOSIT_ADDRESS}");
    expect(out[0].programId).toBe("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
    const sol = withdrawToSolanaSteps(v, intermediary, Keypair.generate().publicKey, 5_000_000n, 4_900_000n, "idle", 4_800_000n);
    expect(() => legal(sol)).not.toThrow();
  });
});

describe("redeem source", () => {
  const nav = (idle: bigint, kamino: bigint, jl: bigint) => ({ idle, kamino, jupiterLend: jl, total: idle + kamino + jl, shareSupply: 0n, sharePrice1e6: 0n, vault: {} as never });
  it("uses idle when it covers the payout", () => expect(redeemSourceFor(nav(10n, 50n, 40n), 10n)).toBe("idle"));
  it("pulls from the strategy that covers the shortfall", () => {
    expect(redeemSourceFor(nav(10n, 50n, 40n), 40n)).toBe("kamino");
    expect(redeemSourceFor(nav(10n, 5n, 40n), 40n)).toBe("jupiter-lend");
  });
});

describe("swap out (Solana wallet to another chain)", () => {
  it("redeems into the wallet and pays exactly the quoted amount to the deposit address", async () => {
    const { swapOutIxs, ata: ataOf, USDC_MINT: mint, LANDFALL_PROGRAM_ID: pid } = await import("../src/index");
    const owner = Keypair.generate().publicKey;
    const depositAddress = Keypair.generate().publicKey;
    const ixs = swapOutIxs(v, owner, 5_000_000n, 4_990_000n, "idle", depositAddress);
    expect(ixs.map((i) => i.programId.toBase58())).toEqual([
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      pid.toBase58(),
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    ]);
    const transfer = ixs[3];
    expect(transfer.keys[0].pubkey.equals(ataOf(owner, mint))).toBe(true);
    expect(transfer.keys[2].pubkey.equals(ataOf(depositAddress, mint))).toBe(true);
    expect(transfer.data.readBigUInt64LE(1)).toBe(4_990_000n);
    // redeem pays into the wallet's own USDC account, with the same floor
    expect(ixs[1].data.readBigUInt64LE(16)).toBe(4_990_000n);
  });

  it("lists only payout destinations with a known asset id", async () => {
    const { WITHDRAW_DESTINATIONS } = await import("../src/index");
    const ids = new Set(WITHDRAW_DESTINATIONS.map((d) => d.id));
    expect(ids.size).toBe(WITHDRAW_DESTINATIONS.length);
    for (const d of WITHDRAW_DESTINATIONS) expect(d.assetId).toMatch(/^nep(141|245):/);
  });
});

describe("transferCheckedIx", () => {
  it("matches the SPL Token library byte for byte", async () => {
    const { createTransferCheckedInstruction } = await import("@solana/spl-token");
    const { transferCheckedIx, USDC_MINT: mint } = await import("../src/index");
    const [a, b, c] = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
    const ours = transferCheckedIx(a, mint, b, c, 1_234_567n);
    const ref = createTransferCheckedInstruction(a, mint, b, c, 1_234_567n, 6);
    expect(Buffer.from(ours.data).equals(Buffer.from(ref.data))).toBe(true);
    expect(ours.keys).toEqual(ref.keys);
    expect(ours.programId.equals(ref.programId)).toBe(true);
  });
});
