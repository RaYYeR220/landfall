import { addressBook } from "@/lib/server/addresses";
import { connectApi, intents } from "@/lib/server/env";
import { bad, handle, json, pubkeyParam } from "@/lib/server/http";
import { chainHistory } from "@/lib/server/position";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Everything that happened to an owner's money, merged: persistent-address
 * deposits as Aurora sees them (received / paid out / failed), Intents Connect
 * executions of the origin wallet, and the vault's own on-chain events.
 */
export const GET = handle(async (req) => {
  const params = new URL(req.url).searchParams;
  const owner = pubkeyParam(params.get("owner"));
  const wallet = params.get("wallet");
  if (!owner) return bad("owner must be a Solana address");

  const [book, chain, executions] = await Promise.all([
    addressBook(owner).catch(() => null),
    chainHistory(owner).catch(() => []),
    wallet ? connectApi().listExecutions(wallet, {}).catch(() => []) : Promise.resolve([]),
  ]);

  const deposits: { chain: string; address: string; status: "received" | "success" | "failed"; tx: string; amount: string; decimals: number | null; asset: string | null; at: string; from?: string }[] = [];
  if (book?.status === "ready") {
    const withAddress = book.chains.filter((c) => c.address);
    for (let i = 0; i < withAddress.length; i += 6) {
      await Promise.all(
        withAddress.slice(i, i + 6).flatMap((c) =>
          (["received", "success", "failed"] as const).map(async (type) => {
            const r = await intents().persistentDeposits(c.address!, type, 20).catch(() => ({ deposits: [] }));
            for (const d of r.deposits) {
              deposits.push({ chain: c.chain, address: c.address!, status: type, tx: d.tx_hash, amount: d.amount, decimals: d.decimals, asset: d.asset_id, at: d.created_at, from: d.from });
            }
          }),
        ),
      );
    }
  }
  return json({ owner: owner.toBase58(), addressStatus: book?.status ?? "unavailable", deposits, executions, chain });
});
