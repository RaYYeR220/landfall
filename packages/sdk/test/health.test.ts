import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { JUPITER_LEND, KAMINO, strategyHealth } from "../src/index";

const FIXTURES = join(__dirname, "../../../programs/landfall/tests/fixtures/accounts");
const load = (k: PublicKey) => {
  const j = JSON.parse(readFileSync(join(FIXTURES, `${k.toBase58()}.json`), "utf8"));
  return Buffer.from(j.account.data[0], "base64");
};

/** A connection that serves mainnet snapshots, optionally patched per account. */
const fakeConnection = (patch: (key: string, d: Buffer) => Buffer | null = (_, d) => d) =>
  ({
    getMultipleAccountsInfo: async (keys: PublicKey[]) =>
      keys.map((k) => {
        const d = patch(k.toBase58(), load(k));
        return d ? ({ data: d, executable: false, lamports: 1, owner: k } as unknown as AccountInfo<Buffer>) : null;
      }),
  }) as unknown as Connection;

describe("strategy health", () => {
  it("reads the live Kamino reserve and Jupiter Lend pool from mainnet snapshots", async () => {
    const h = await strategyHealth(fakeConnection());
    expect(h.kamino.readable).toBe(true);
    expect(h.kamino.active).toBe(true);
    expect(h.kamino.emergencyMode).toBe(false);
    expect(h.kamino.totalLiquidity).toBeGreaterThan(0n);
    expect(h.kamino.depositLimit).toBeGreaterThan(h.kamino.totalLiquidity);
    expect(h.kamino.acceptsDeposits).toBe(true);
    expect(h.jupiterLend.readable).toBe(true);
    expect(h.jupiterLend.exchangePrice).toBeGreaterThan(1_000_000_000_000n);
  });

  it("flags a reserve at its deposit limit", async () => {
    const h = await strategyHealth(
      fakeConnection((k, d) => {
        if (k !== KAMINO.reserve.toBase58()) return d;
        const total = d.readBigUInt64LE(224); // available liquidity is enough to sit at the limit
        d.writeBigUInt64LE(total, 5016);
        return d;
      }),
    );
    expect(h.kamino.headroom).toBe(0n);
    expect(h.kamino.acceptsDeposits).toBe(false);
  });

  it("flags emergency mode and an obsolete reserve", async () => {
    const h = await strategyHealth(
      fakeConnection((k, d) => {
        if (k === KAMINO.market.toBase58()) d[122] = 1;
        if (k === KAMINO.reserve.toBase58()) d[4856] = 1;
        return d;
      }),
    );
    expect(h.kamino.emergencyMode).toBe(true);
    expect(h.kamino.active).toBe(false);
    expect(h.kamino.acceptsDeposits).toBe(false);
  });

  it("reports an unreadable layout instead of guessing", async () => {
    const h = await strategyHealth(
      fakeConnection((k, d) => (k === KAMINO.reserve.toBase58() ? d.subarray(0, 4000) : k === JUPITER_LEND.lending.toBase58() ? null : d)),
    );
    expect(h.kamino.readable).toBe(false);
    expect(h.kamino.acceptsDeposits).toBe(false);
    expect(h.jupiterLend.readable).toBe(false);
  });
});
