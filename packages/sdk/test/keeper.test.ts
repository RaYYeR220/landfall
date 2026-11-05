import { describe, expect, it } from "vitest";
import { nextAllocation, type Nav } from "../src/index";

const nav = (idle: bigint, kamino: bigint, jl: bigint, over: Partial<Nav["vault"]> = {}): Nav => ({
  idle, kamino, jupiterLend: jl, total: idle + kamino + jl, shareSupply: 0n, sharePrice1e6: 0n,
  vault: {
    paused: false, idleBufferBps: 1000,
    kamino: { enabled: true, weightBps: 6000, cap: 10n ** 15n },
    jlend: { enabled: true, weightBps: 3000, cap: 10n ** 15n },
    ...over,
  } as Nav["vault"],
});

describe("nextAllocation", () => {
  it("fills the strategy furthest below target, keeping the idle buffer", () => {
    // NAV 100: buffer 10, kamino target 60, jlend target 30
    expect(nextAllocation(nav(100_000_000n, 0n, 0n), 2_000_000n)).toEqual({ strategy: "kamino", amount: 60_000_000n });
    expect(nextAllocation(nav(40_000_000n, 60_000_000n, 0n), 2_000_000n)).toEqual({ strategy: "jupiter-lend", amount: 30_000_000n });
  });
  it("never dips into the buffer", () => {
    expect(nextAllocation(nav(10_000_000n, 60_000_000n, 30_000_000n), 1n)).toBeNull();
  });
  it("respects caps and pause", () => {
    const capped = nav(100_000_000n, 0n, 0n, { kamino: { enabled: true, weightBps: 6000, cap: 5_000_000n } as never });
    expect(nextAllocation(capped, 1n)).toEqual({ strategy: "jupiter-lend", amount: 30_000_000n });
    expect(nextAllocation(nav(100_000_000n, 0n, 0n, { paused: true }), 1n)).toBeNull();
  });
  it("skips dust", () => {
    expect(nextAllocation(nav(11_000_000n, 59_500_000n, 29_500_000n), 2_000_000n)).toBeNull();
  });
});
