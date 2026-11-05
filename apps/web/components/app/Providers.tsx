"use client";

import { useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createIntentsConnectApi, type IntentsConnectApi } from "@aurora-is-near/intents-connect";
import { IntentsConnectProvider } from "@aurora-is-near/intents-connect/react";
import { AppKitProvider, useIntentsConnectWallet } from "@aurora-is-near/intents-connect-wallet/connect/appkit";
import { AURORA } from "@landfall/sdk";
import { createContext, useContext } from "react";

type WalletState = ReturnType<typeof useIntentsConnectWallet>;

const Ctx = createContext<{ api: IntentsConnectApi; wallet: WalletState } | null>(null);

export const useLandfallWallet = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLandfallWallet outside Providers");
  return v;
};

const Inner = ({ children }: { children: ReactNode }) => {
  const wallet = useIntentsConnectWallet();
  const api = useMemo(
    () =>
      createIntentsConnectApi({
        baseUrl: AURORA.connectApi,
        // execution create calls go through our server, which adds the Aurora API key
        apiKeyProxyUrl: typeof window === "undefined" ? undefined : `${window.location.origin}/api/intents-connect`,
      }),
    [],
  );
  return (
    <IntentsConnectProvider api={api} wallet={wallet.wallet}>
      <Ctx.Provider value={{ api, wallet }}>{children}</Ctx.Provider>
    </IntentsConnectProvider>
  );
};

export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1 } } }));
  return (
    <QueryClientProvider client={client}>
      <AppKitProvider appName="Landfall" themeMode="dark">
        <Inner>{children}</Inner>
      </AppKitProvider>
    </QueryClientProvider>
  );
}
