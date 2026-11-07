import { ComputeBudgetProgram, type Connection, type Keypair, Transaction, type TransactionInstruction } from "@solana/web3.js";

export type SendOptions = {
  /** Compute-unit limit for the transaction (also sizes the priority fee). */
  computeUnits?: number;
  /** Micro-lamports per compute unit. */
  priorityFee?: number;
  /** Fresh-blockhash attempts before giving up. */
  attempts?: number;
  log?: (msg: string) => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Sends and confirms without relying on websockets, rebroadcasting the same
 * signed transaction every two seconds until it confirms or its blockhash
 * expires, then retrying with a fresh blockhash. Unstaked RPC endpoints drop
 * transactions under load; this keeps landing reliable without one.
 */
export const sendReliably = async (connection: Connection, ixs: TransactionInstruction[], signers: Keypair[], o: SendOptions = {}): Promise<string> => {
  const attempts = o.attempts ?? 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction();
    if (o.computeUnits) tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: o.computeUnits }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: o.priorityFee ?? 50_000 }), ...ixs);
    tx.feePayer = signers[0].publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(...signers);
    const raw = tx.serialize();
    let signature: string;
    try {
      // the first send simulates, so a transaction that would fail is reported, not rebroadcast
      signature = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });
    } catch (e) {
      lastError = e;
      const msg = (e as Error).message ?? "";
      if (!/blockhash not found|429|timeout|fetch failed/i.test(msg)) throw e;
      o.log?.(`attempt ${attempt}: ${msg.slice(0, 120)}`);
      await sleep(1500);
      continue;
    }
    while (true) {
      const { value } = await connection.getSignatureStatuses([signature]).catch(() => ({ value: [null] }));
      const s = value[0];
      if (s?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(s.err)}`);
      if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return signature;
      const height = await connection.getBlockHeight("confirmed").catch(() => 0);
      if (height > lastValidBlockHeight) break;
      await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
      await sleep(2000);
    }
    o.log?.(`attempt ${attempt}: ${signature.slice(0, 16)}… expired, retrying with a fresh blockhash`);
    lastError = new Error(`transaction ${signature} expired`);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};
