import { PageHeader } from "@/components/PageHeader";

/**
 * A reading companion for the code. Each section names the files that own the
 * behaviour it describes — the app is the documentation's proof.
 */
function Section({ title, file, children }: { title: string; file: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{file}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
    </section>
  );
}

export default function Architecture() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="How this works" />
      <p className="text-sm leading-6 text-muted-foreground">
        The copilot does not click your UI, and it does not receive a pile of ad-hoc functions. The
        application declares two planes of capabilities, an application-owned host composes them per
        turn, and a runtime reasons over the result. One operation always has one canonical identity
        and one execution path.
      </p>

      <Section title="view: — the presentation plane" file="app/lib/hooks/useTableAgentComponent.ts">
        Capabilities that only make sense against the mounted screen: read the visible rows, narrow
        them, sort them, change the columns, select rows. They are registered by the components that
        own the state, exist only while mounted, and route through the same setters the toolbar
        calls — so an agent-narrowed view is a view you can bookmark.
      </Section>

      <Section title="domain: — the authoritative plane" file="capabilities/">
        Flat oRPC procedures with <code>meta.agent</code>. Exposure is deny-by-default and declared
        per surface. The registry is the only definition; <code>server/rpc.ts</code> serves it to the
        UI with writes governed, <code>server/agent/host.ts</code> serves it to the model, and{" "}
        <code>server/mcp.ts</code> serves it to MCP clients.
      </Section>

      <Section title="Bind for context, gate for consequence" file="app/agent/domain/manifest.ts">
        <code>update-collection-status</code> is <code>aiSdk: false</code>: the model reaches it only
        through the open chase dialog, with <code>invoiceId</code> bound and locked.{" "}
        <code>issue-invoice</code> is the opposite — a direct governed tool whose model-initiated
        calls suspend into a server-side approval record. Binding it instead would trade a persisted
        approval for a browser dialog, which is weaker authority on the operation that least wants
        it.
      </Section>

      <Section title="The Agent Host" file="app/agent/host/ · server/agent/host.ts">
        Application-owned composition: a versioned browser↔server protocol, per-request catalog
        assembly, duplicate-path rejection, wire-name mapping, dispatch, correlation ids and typed
        transport errors. Logically one layer, physically split across the browser and the chat
        route. Frontend tools execute BETWEEN requests, so a confirmation never holds a stream open.
      </Section>

      <Section title="Mastra + assistant-ui" file="server/mastra.ts · app/features/copilot/">
        Mastra runs the loop over tools the host composed — it owns planning and run limits, not
        capability truth. assistant-ui renders the thread; swap it and both capability planes survive
        untouched.
      </Section>
    </div>
  );
}
