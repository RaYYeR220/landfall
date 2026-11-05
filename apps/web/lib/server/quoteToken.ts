import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { auroraKey } from "./env";

/** Binds a Swap API deposit address to a quote this server issued, without storing anything. */
const mac = (depositAddress: string) => createHmac("sha256", `landfall-withdraw:${auroraKey()}`).update(depositAddress).digest("base64url");

export const quoteToken = (depositAddress: string) => mac(depositAddress);

export const checkQuoteToken = (depositAddress: string, token: unknown) => {
  if (typeof token !== "string") return false;
  const a = Buffer.from(mac(depositAddress));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
};
