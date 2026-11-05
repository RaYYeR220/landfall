"use client";

import { Connection, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";

export type SolanaSigner = { signTransaction: (t: Transaction) => Promise<Transaction> };

export const rpc = () => new Connection(`${window.location.origin}/api/solana-rpc`, "confirmed");

/** Signs in the wallet, sends, and polls for confirmation (the RPC proxy is HTTP only, no websockets). */
export const signAndSend = async (signer: SolanaSigner, feePayer: PublicKey, ixs: TransactionInstruction[], onSent?: (sig: string) => void) => {
  const conn = rpc();
  const tx = new Transaction().add(...ixs);
  tx.feePayer = feePayer;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  const signed = await signer.signTransaction(tx);
  const sig = await conn.sendRawTransaction(signed.serialize(), { maxRetries: 5 });
  onSent?.(sig);
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const s = value[0];
    if (s?.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`not confirmed after 90 s — check ${sig.slice(0, 12)}… on an explorer`);
};
