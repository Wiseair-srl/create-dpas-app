import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep server-only agent code out of client bundles. The Agent Host is
  // deliberately split: src/server/** and src/agent/runtime/** must never be
  // imported from a client component (enforced by the `server-only` marker
  // imports inside those modules).
  reactStrictMode: true,
};

export default nextConfig;
