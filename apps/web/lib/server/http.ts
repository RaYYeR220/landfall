import "server-only";
import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";

export const json = (data: unknown, init?: number | ResponseInit) =>
  NextResponse.json(data, typeof init === "number" ? { status: init } : init);

export const bad = (message: string, status = 400) => json({ error: message }, status);

export const pubkeyParam = (v: string | null) => {
  if (!v) return null;
  try {
    return new PublicKey(v);
  } catch {
    return null;
  }
};

export const handle = (fn: (req: Request) => Promise<Response>) => async (req: Request) => {
  try {
    return await fn(req);
  } catch (e) {
    const err = e as Error & { status?: number };
    console.error(err);
    return bad(err.message ?? "unexpected error", err.status && err.status >= 400 ? err.status : 500);
  }
};
