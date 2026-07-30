"use client";

import { useQuery } from "@tanstack/react-query";

export interface AppConfig {
  provider: "demo" | "anthropic" | "openai" | "mock";
  label: string;
  live: boolean;
}

export function useAppConfig() {
  return useQuery<AppConfig>({
    queryKey: ["app-config"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to load app config");
      return (await res.json()) as AppConfig;
    },
    staleTime: Infinity,
  });
}
