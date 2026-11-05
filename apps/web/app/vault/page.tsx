import type { Metadata } from "next";
import VaultConsole from "@/components/vault/VaultConsole";

export const metadata: Metadata = { title: "Landfall — vault" };

export default function Page() {
  return <VaultConsole />;
}
