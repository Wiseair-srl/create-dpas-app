import type { Metadata } from "next";
import { ArchitectureMap } from "@/components/agent-inspector/architecture-map";

export const metadata: Metadata = { title: "Architecture" };

/**
 * A reading companion for the code. Each section names the files that own the
 * behavior it describes — the app is the documentation's proof.
 */
export default function ArchitecturePage() {
  return (
    // Keyboard users scroll this region directly, so it is focusable.
    <div
      className="dpas-scroll min-h-0 flex-1 overflow-y-auto"
      tabIndex={0}
      role="region"
      aria-label="Architecture guide"
    >
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-xl font-semibold">The Dual-Plane Agent Stack, in this app</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The assistant does not click your UI or receive a pile of ad-hoc functions. The
          application declares two planes of capabilities, an application-owned host composes them
          per turn, and a runtime reasons over the result. One operation always has one canonical
          identity and one execution path.
        </p>

        <div className="mt-8 rounded-lg border border-border bg-surface p-5">
          <ArchitectureMap />
        </div>

        <Section title="view: — the presentation plane" file="src/features/devices/components/*">
          Capabilities that only make sense against the currently mounted page: read and set
          filters, read and change the selection, open the drawer, navigate. They are registered by
          the components that own the state (via Agent Surface), exist only while mounted, and are
          re-checked at invocation — a stale or unmounted capability fails with a typed error, never
          a ghost click.
        </Section>

        <Section title="domain: — the authoritative plane" file="src/server/orpc/procedures.ts">
          Real oRPC procedures with agent metadata. <code>devices.list</code> and{" "}
          <code>devices.get</code> are exposed to the model as direct server tools;{" "}
          <code>devices.disable</code> deliberately is not. The server re-derives identity and
          re-authorizes every call — nothing the browser sends is trusted.
        </Section>

        <Section title="The contextual reference" file="src/features/devices/components/devices-table.tsx">
          <code>domain:devices.disable</code> reaches the model only through the surface: hidden for
          viewers (authority hides), unavailable until rows are selected (state discloses), its{" "}
          <code>deviceIds</code> bound to the live selection and locked, and gated by a single-use,
          input-bound confirmation. Approve, and the call rides the same authenticated oRPC client a
          button would use.
        </Section>

        <Section title="The Agent Host" file="src/agent/host/*">
          Application-owned composition: a versioned browser↔server protocol, per-turn catalog
          assembly, duplicate-path rejection, wire-name mapping, dispatch, correlation ids, and
          typed transport errors. Logically one layer, physically split across the browser and the
          chat route.
        </Section>

        <Section title="Mastra + assistant-ui" file="src/agent/runtime/* · src/agent/experience/*">
          Mastra runs the loop over tools the host composed — it owns planning and run limits, not
          capability truth. assistant-ui renders the thread, streaming, tool cards and the
          confirmation experience; swap it and both capability planes survive untouched.
        </Section>

        <p className="mt-10 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
          Deeper reading in this repo: <code>docs/architecture.md</code>,{" "}
          <code>docs/security-and-confirmation.md</code>, <code>docs/tracing-a-tool-call.md</code>,
          and the how-tos for adding view capabilities, domain capabilities, and contextual actions.
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  file,
  children,
}: {
  title: string;
  file: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-0.5 font-mono text-[11px] text-faint-foreground">{file}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
    </section>
  );
}
