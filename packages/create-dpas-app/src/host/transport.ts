export interface HostTransportOptions {
  /** Separate deployment origins; URLs may include a path prefix. */
  backendUrl: string;
  agentUrl: string;
  /** Fetch resolves fresh credentials per request; never persist bearer tokens. */
  fetch?: typeof globalThis.fetch;
  credentials?: RequestCredentials;
}

/** Browser-safe transport; auth, CORS, cookies and routing remain application-owned. */
export function createHostTransport(options: HostTransportOptions) {
  const authenticatedFetch = options.fetch ?? globalThis.fetch;
  const request = (base: string, path: string, init?: RequestInit) =>
    authenticatedFetch(`${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
      ...init,
      credentials: init?.credentials ?? options.credentials ?? "same-origin",
    });
  return {
    backend: (path: string, init?: RequestInit) => request(options.backendUrl, path, init),
    agent: (path: string, init?: RequestInit) => request(options.agentUrl, path, init),
  };
}
