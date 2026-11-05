import { describe, expect, it } from "vitest";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { ata, LANDFALL_PROGRAM_ID, USDC_MINT, vaultAddresses } from "@landfall/sdk";
import { createLandfall } from "../src/landfall";

const v = vaultAddresses();
const wallet = Keypair.generate().publicKey.toBase58();
const depositAddress = Keypair.generate().publicKey.toBase58();

/** Serves the Landfall API and the one RPC call the builders make. */
const fake = () => {
  const calls: { path: string; body?: unknown }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: url.pathname, body });
    const reply = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
    if (url.host === "rpc.test") return reply({ jsonrpc: "2.0", id: body.id, result: { context: { slot: 1 }, value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 100 } } });
    if (url.pathname === "/api/identity") return reply({ wallet, owner: wallet, ownsDirectly: true, inbox: "x" });
    if (url.pathname === "/api/position") return reply({ owner: wallet, shares: 10, value: 10.5, sharePrice: 1.05 });
    if (url.pathname === "/api/vault") return reply({ nav: { total: 100, idle: 50, kamino: 30, jupiterLend: 20 }, sharePrice: 1.05, paused: false });
    if (url.pathname === "/api/withdraw/quote") return reply({ depositAddress, token: "t", amountOutFormatted: "10.4", timeEstimate: 20 });
    if (url.pathname === "/api/addresses") return reply({ owner: body.owner, chains: [] });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
};

const decode = (b64: string) => Transaction.from(Buffer.from(b64, "base64"));

describe("landfall MCP operations", () => {
  it("builds an unsigned deposit the wallet pays for", async () => {
    const { f } = fake();
    const lf = createLandfall({ baseUrl: "https://app.test", rpcUrl: "https://rpc.test", fetch: f });
    const r = await lf.buildDeposit(wallet, 2.5);
    const tx = decode(r.transaction);
    expect(tx.feePayer?.toBase58()).toBe(wallet);
    expect(tx.instructions.at(-1)!.programId.equals(LANDFALL_PROGRAM_ID)).toBe(true);
    expect(tx.instructions.at(-1)!.data.readBigUInt64LE(8)).toBe(2_500_000n);
    expect(tx.signatures.every((s) => s.signature === null)).toBe(true);
  });

  it("withdraws to another chain through a quote for exactly the redemption floor", async () => {
    const { f, calls } = fake();
    const lf = createLandfall({ baseUrl: "https://app.test", rpcUrl: "https://rpc.test", fetch: f });
    const r = await lf.buildWithdraw(wallet, 100, "tron-usdt", "TQsPKSnfXZdzHoxW6W7LnhX8WDtnJyR11h");
    const quote = calls.find((c) => c.path === "/api/withdraw/quote")!.body as { amount: string; destination: string };
    expect(quote.destination).toBe("tron-usdt");
    expect(quote.amount).toBe(((10_500_000n * 995n) / 1000n).toString());
    const tx = decode(r.transaction);
    const transfer = tx.instructions.at(-1)!;
    expect(transfer.keys[2].pubkey.equals(ata(new PublicKey(depositAddress), USDC_MINT))).toBe(true);
    expect(transfer.data.readBigUInt64LE(1)).toBe(BigInt(quote.amount));
    expect(r.token).toBe("t");
  });

  it("refuses an unknown destination and a missing recipient", async () => {
    const { f } = fake();
    const lf = createLandfall({ baseUrl: "https://app.test", rpcUrl: "https://rpc.test", fetch: f });
    await expect(lf.buildWithdraw(wallet, 50, "dogecoin", "x")).rejects.toThrow(/destination/);
    await expect(lf.buildWithdraw(wallet, 50, "btc")).rejects.toThrow(/recipient/);
  });

  it("resolves the share owner before asking for addresses", async () => {
    const { f, calls } = fake();
    const lf = createLandfall({ baseUrl: "https://app.test", rpcUrl: "https://rpc.test", fetch: f });
    await lf.addresses(wallet);
    expect(calls.map((c) => c.path)).toEqual(["/api/identity", "/api/addresses"]);
    expect((calls[1].body as { owner: string }).owner).toBe(wallet);
    expect(v.vault).toBeTruthy();
  });
});
