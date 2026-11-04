import "server-only";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { createIntentsConnectApi } from "@aurora-is-near/intents-connect";
import { AURORA, createIntentsClient, vaultAddresses } from "@landfall/sdk";

const required = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not configured`);
  return v;
};

const parseSecret = (raw: string) => (raw.trim().startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw.trim()));

let _conn: Connection | undefined;
export const connection = () => (_conn ??= new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed"));

let _keeper: Keypair | undefined;
export const keeper = () => (_keeper ??= Keypair.fromSecretKey(parseSecret(required("KEEPER_SECRET_KEY"))));

export const vault = vaultAddresses();

export const auroraKey = () => required("AURORA_API_KEY");
export const hasAuroraKey = () => Boolean(process.env.AURORA_API_KEY);

let _intents: ReturnType<typeof createIntentsClient> | undefined;
export const intents = () => (_intents ??= createIntentsClient({ apiKey: auroraKey() }));

/** Intents Connect API client. Create calls carry the API key (server side only). */
let _connect: ReturnType<typeof createIntentsConnectApi> | undefined;
export const connectApi = () => (_connect ??= createIntentsConnectApi({ baseUrl: AURORA.connectApi, apiKey: process.env.AURORA_API_KEY }));
