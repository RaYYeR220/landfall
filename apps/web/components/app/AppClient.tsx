"use client";

import dynamic from "next/dynamic";

// wallet libraries touch window at import time
const AppRoot = dynamic(() => import("./AppRoot"), { ssr: false, loading: () => <div className="min-h-screen" /> });

export default function AppClient() {
  return <AppRoot />;
}
