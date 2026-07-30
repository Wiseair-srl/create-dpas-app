import { cn } from "@/lib/cn";

/**
 * The DPAS topology at a glance. One catalog is presented to the model, but
 * execution stays partitioned: view capabilities run in the browser, domain
 * procedures run on the server — composition never merges authority.
 */
export function ArchitectureMap({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={cn("select-none", compact ? "text-[10px]" : "text-xs")}>
      <div className="grid gap-1.5">
        <MapBox tone="experience" label="assistant-ui — Agent Experience Layer" detail="chat, streaming, tool & confirmation UX (replaceable)" compact={compact} />
        <Arrow />
        <MapBox tone="host" label="Agent Host — application-owned" detail="protocol · catalog composition · dispatch · correlation" compact={compact} />
        <Arrow />
        <MapBox tone="runtime" label="Mastra — Agent Runtime" detail="planning · agent loop · run limits" compact={compact} />
        <div className="grid grid-cols-2 gap-1.5">
          <div className="grid gap-1.5">
            <Arrow />
            <MapBox
              tone="view"
              label="Agent Surface"
              detail="view:* capabilities · lifecycle · binding · confirmation — runs in the browser"
              compact={compact}
            />
          </div>
          <div className="grid gap-1.5">
            <Arrow />
            <MapBox
              tone="domain"
              label="oRPC Agent"
              detail="domain:* procedures · policy · audit — authoritative on the server"
              compact={compact}
            />
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-[11px] leading-4 text-muted-foreground">
        One model-facing catalog, two execution planes. The unified list the model sees never
        implies unified execution authority: every domain call is re-authorized server-side.
      </figcaption>
    </figure>
  );
}

function MapBox({
  tone,
  label,
  detail,
  compact,
}: {
  tone: "experience" | "host" | "runtime" | "view" | "domain";
  label: string;
  detail: string;
  compact: boolean;
}) {
  const toneClasses: Record<typeof tone, string> = {
    experience: "border-border-strong",
    host: "border-accent/50 bg-accent-soft/40",
    runtime: "border-border-strong",
    view: "border-plane-view/50 bg-plane-view-soft/40",
    domain: "border-plane-domain/50 bg-plane-domain-soft/40",
  };
  return (
    <div className={cn("rounded-md border px-2.5 py-1.5", toneClasses[tone])}>
      <p className="font-medium leading-4">{label}</p>
      {!compact ? <p className="mt-0.5 leading-4 text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function Arrow() {
  return (
    <div aria-hidden className="text-center leading-none text-faint-foreground">
      ↕
    </div>
  );
}
