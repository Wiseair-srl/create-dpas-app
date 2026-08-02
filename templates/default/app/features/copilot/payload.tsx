import { cn } from "@/lib/utils";

import { scalarFields } from "./receipt";

/**
 * How the copilot renders a JSON payload, in one place: a tool call's
 * arguments, an approval's input, a capability's result. Three surfaces show
 * payloads — the tool pill, the approval card, the receipt — and before this
 * they each rendered their own `JSON.stringify`, which is what made a thread
 * full of writes read like a log file.
 *
 * The rule: a flat object of scalars is a field list, because `{"id":58}` is a
 * fact about a scenario and the braces are noise. Anything nested keeps its
 * JSON, where the shape is the information.
 */

/** `scenario_id` / `scenarioId` → "Scenario id". */
export function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, " ").replace(/([a-z\d])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** `{}` and `null` are not worth a line of the thread. */
export function isEmptyPayload(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "object") return false;
  return Object.keys(value as object).length === 0;
}

/** Values print as themselves — a quoted string inside a field list is noise. */
function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

/**
 * The collapsed tool pill's one line of arguments: `id 58 · dry-run true`,
 * keys dimmer than values so the eye lands on what changed. Anything the field
 * list can't take keeps its JSON.
 */
export function PayloadSummary({ value }: { value: unknown }) {
  const fields = scalarFields(value);
  if (!fields) return <>{JSON.stringify(value)}</>;
  return (
    <>
      {fields.map(([key, item], i) => (
        <span key={key}>
          {/* Not `text-border`: the hairline token disappears into the dark card. */}
          {i > 0 && <span className="text-muted-foreground/40"> · </span>}
          <span className="text-muted-foreground/60">{key}</span>{" "}
          <span className="text-muted-foreground">{display(item)}</span>
        </span>
      ))}
    </>
  );
}

/** Subgrid keeps every value on one column no matter how long the keys run. */
export function FieldList({
  fields,
  className,
}: {
  fields: [string, unknown][];
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-xs", className)}>
      {fields.map(([key, value]) => (
        <div key={key} className="col-span-2 grid grid-cols-subgrid items-baseline">
          <dt className="text-muted-foreground">{humanize(key)}</dt>
          <dd className="min-w-0 truncate font-medium tabular-nums text-foreground">
            {display(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-56 overflow-auto font-mono text-[11px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Field list when the payload is flat, JSON when it isn't, nothing when empty. */
export function PayloadView({ value, className }: { value: unknown; className?: string }) {
  const fields = scalarFields(value);
  if (fields) return fields.length ? <FieldList fields={fields} className={className} /> : null;
  return <JsonBlock value={value} className={className} />;
}
