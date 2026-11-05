"use client";

import Providers from "./Providers";
import LandfallApp from "./LandfallApp";

export default function AppRoot() {
  return (
    <Providers>
      <LandfallApp />
    </Providers>
  );
}
