"use client";

import { useQuery } from "@tanstack/react-query";
import { getJson, type Activity, type Identity, type Position, type VaultSummary } from "./api";

export const useIdentity = (wallet?: string) =>
  useQuery({
    queryKey: ["identity", wallet],
    queryFn: () => getJson<Identity>(`/api/identity?wallet=${encodeURIComponent(wallet!)}`),
    enabled: Boolean(wallet),
    staleTime: Infinity,
  });

export const usePosition = (owner?: string) =>
  useQuery({
    queryKey: ["position", owner],
    queryFn: () => getJson<Position>(`/api/position?owner=${owner}&history=1`),
    enabled: Boolean(owner),
    refetchInterval: 12_000,
  });

export const useVault = () =>
  useQuery({ queryKey: ["vault"], queryFn: () => getJson<VaultSummary>("/api/vault"), refetchInterval: 30_000, retry: 0 });

export const useActivity = (owner?: string, wallet?: string) =>
  useQuery({
    queryKey: ["activity", owner, wallet],
    queryFn: () => getJson<Activity>(`/api/activity?owner=${owner}${wallet ? `&wallet=${encodeURIComponent(wallet)}` : ""}`),
    enabled: Boolean(owner),
    refetchInterval: 20_000,
  });
