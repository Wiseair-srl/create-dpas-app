/** Configure once at application bootstrap; fetch must resolve current auth per request. */
export interface ApplicationTransport {
  backendUrl?: string;
  agentUrl?: string;
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
}

let transport: ApplicationTransport = {};

export function configureApplicationTransport(options: ApplicationTransport): void {
  transport = { ...options };
}

export function backendEndpoint(path: string): string {
  return endpoint(
    transport.backendUrl ?? import.meta.env.VITE_BACKEND_URL ?? window.location.origin,
    path,
  );
}

export function agentEndpoint(path: string): string {
  return endpoint(
    transport.agentUrl ?? import.meta.env.VITE_AGENT_URL ?? window.location.origin,
    path,
  );
}

function endpoint(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

/** Thread memory lives with the agent; domain reads, approvals and auth with the backend. */
export function applicationFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const target =
    typeof input === "string" && input.startsWith("/")
      ? input.startsWith("/agent/") || input.startsWith("/api/threads")
        ? agentEndpoint(input)
        : backendEndpoint(input)
      : input;
  return (transport.fetch ?? globalThis.fetch)(target, {
    ...init,
    credentials: transport.credentials ?? init?.credentials ?? "include",
  });
}
