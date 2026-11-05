import type { Metadata } from "next";
import AppClient from "@/components/app/AppClient";

export const metadata: Metadata = { title: "Landfall — your addresses" };

export default function Page() {
  return <AppClient />;
}
