"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface AppConfig {
  provider: "demo" | "anthropic" | "openai" | "openrouter" | "mock";
  label: string;
  live: boolean;
  source: "env" | "runtime" | "none";
  modelId: string | null;
  /** Whether this deployment accepts a key from the UI at all. */
  runtimeConfigurable: boolean;
  /** Masked description of a UI-connected key — never the key itself. */
  runtime: { provider: string; modelId: string; keyHint: string } | null;
}

const CONFIG_KEY = ["app-config"] as const;

async function readConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Failed to load app config");
  return (await res.json()) as AppConfig;
}

export function useAppConfig() {
  return useQuery<AppConfig>({
    queryKey: CONFIG_KEY,
    queryFn: readConfig,
    staleTime: 30_000,
  });
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    if (body.error?.message) return body.error.message;
  } catch {
    // fall through
  }
  return `Request failed (${res.status}).`;
}

/** Connect a provider key. The key is sent once and never comes back. */
export function useConnectModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { provider: "openrouter"; apiKey: string; modelId?: string }) => {
      const res = await fetch("/api/config/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await parseError(res));
      return (await res.json()) as AppConfig;
    },
    onSuccess: (config) => queryClient.setQueryData(CONFIG_KEY, config),
  });
}

export function useDisconnectModel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/config/model", { method: "DELETE" });
      if (!res.ok) throw new Error(await parseError(res));
      return (await res.json()) as AppConfig;
    },
    onSuccess: (config) => queryClient.setQueryData(CONFIG_KEY, config),
  });
}

export function useTestModelKey() {
  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/config/model/test", { method: "POST" });
      return (await res.json()) as { ok: boolean; reason: string };
    },
  });
}
