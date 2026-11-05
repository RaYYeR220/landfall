#!/usr/bin/env -S npx tsx
/**
 * Landfall MCP server (stdio).
 *
 *   LANDFALL_URL=https://… SOLANA_RPC_URL=https://… npx tsx packages/mcp/src/index.ts
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WITHDRAW_DESTINATIONS } from "@landfall/sdk";
import { createLandfall } from "./landfall";

const lf = createLandfall({
  baseUrl: process.env.LANDFALL_URL ?? "http://localhost:3000",
  rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
});

const server = new McpServer({ name: "landfall", version: "0.1.0" });

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const safe =
  <A,>(fn: (a: A) => Promise<unknown>) =>
  async (a: A) => {
    try {
      return text(await fn(a));
    } catch (e) {
      return { ...text(`error: ${(e as Error).message}`), isError: true };
    }
  };

const wallet = z.string().describe("The user's wallet: a Solana address, or an EVM 0x address");

server.registerTool(
  "vault_status",
  {
    title: "Landfall vault status",
    description: "NAV, share price, blended APY, allocation between Kamino and Jupiter Lend, and live checks of both lending markets.",
    inputSchema: {},
  },
  safe(async () => lf.vault()),
);

server.registerTool(
  "deposit_addresses",
  {
    title: "Permanent deposit addresses",
    description:
      "The wallet's permanent deposit address on every supported chain (EVM chains share one). Anything sent there lands in the wallet's Landfall position on Solana. A new wallet must sign in once in the Landfall app before addresses are issued.",
    inputSchema: { wallet, confidential: z.boolean().optional().describe("Confidential Intents addresses") },
  },
  safe(async ({ wallet: w, confidential }: { wallet: string; confidential?: boolean }) => lf.addresses(w, confidential)),
);

server.registerTool(
  "position",
  {
    title: "Position",
    description: "lfUSDC shares, their USDC value, any USDC waiting in the inbox, and recent landings and withdrawals.",
    inputSchema: { wallet },
  },
  safe(async ({ wallet: w }: { wallet: string }) => lf.position(w)),
);

server.registerTool(
  "activity",
  {
    title: "Activity",
    description: "Deposits seen on every chain, Intents Connect executions, and on-chain landings for the wallet.",
    inputSchema: { wallet },
  },
  safe(async ({ wallet: w }: { wallet: string }) => lf.activity(w)),
);

server.registerTool(
  "build_deposit",
  {
    title: "Build a deposit (Solana wallet)",
    description: "Returns an unsigned base64 Solana transaction that deposits USDC from a Solana wallet into Landfall. Sign it with that wallet and send it.",
    inputSchema: { wallet: z.string().describe("Solana wallet holding USDC"), amount_usdc: z.number().positive() },
  },
  safe(async ({ wallet: w, amount_usdc }: { wallet: string; amount_usdc: number }) => lf.buildDeposit(w, amount_usdc)),
);

server.registerTool(
  "build_withdraw",
  {
    title: "Build a withdrawal (Solana wallet)",
    description: `Returns an unsigned base64 Solana transaction that withdraws part of a Solana wallet's position, either back to the wallet ("solana") or to another chain through an Aurora Intents swap (${WITHDRAW_DESTINATIONS.map((d) => d.id).join(", ")}).`,
    inputSchema: {
      wallet: z.string().describe("Solana wallet that owns the lfUSDC"),
      percent: z.number().min(1).max(100).default(100),
      destination: z.string().default("solana"),
      recipient: z.string().optional().describe("Address on the destination chain (not needed for solana)"),
    },
  },
  safe(async (a: { wallet: string; percent: number; destination: string; recipient?: string }) => lf.buildWithdraw(a.wallet, a.percent, a.destination, a.recipient)),
);

server.registerTool(
  "withdraw_status",
  {
    title: "Cross-chain withdrawal status",
    description: "Status of a withdrawal to another chain. Pass the transaction signature once it is sent so the swap starts right away.",
    inputSchema: { deposit_address: z.string(), token: z.string(), tx_signature: z.string().optional() },
  },
  safe(async (a: { deposit_address: string; token: string; tx_signature?: string }) => lf.withdrawStatus(a.deposit_address, a.token, a.tx_signature)),
);

await server.connect(new StdioServerTransport());
