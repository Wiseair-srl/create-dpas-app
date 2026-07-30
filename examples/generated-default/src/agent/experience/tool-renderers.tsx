"use client";

import { AlertTriangle, Check, Globe, MonitorSmartphone, ServerCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import type { ChatEntry } from "./message-store";

/**
 * Tool-call cards. A reader must be able to tell at a glance:
 *  - WHERE it executes (browser view-plane vs authoritative domain-plane),
 *  - whether it changed only the visible page or persistent data,
 *  - whether it is still running, succeeded, failed, or awaits confirmation.
 * Status is always conveyed with text, never color alone.
 */

type ToolEntry = Extract<ChatEntry, { kind: "tool" }>;

export function ToolCallCard({ entry }: { entry: ToolEntry }) {
  const isDomain = entry.plane === "domain";
  const error = extractError(entry);
  const status: "running" | "ok" | "error" = entry.status;

  return (
    <div
      data-testid="tool-card"
      data-plane={entry.plane}
      data-status={status}
      data-capability={entry.canonicalId}
      className={cn(
        "rounded-lg border text-left",
        isDomain ? "border-plane-domain/40" : "border-plane-view/40",
        status === "error" && "border-danger/50",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {isDomain ? (
          <ServerCog aria-hidden className="h-4 w-4 shrink-0 text-plane-domain" />
        ) : (
          <MonitorSmartphone aria-hidden className="h-4 w-4 shrink-0 text-plane-view" />
        )}
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{entry.canonicalId}</code>
        <Badge variant={isDomain ? "domain" : "view"}>
          {isDomain ? "DOMAIN" : "VIEW"}
        </Badge>
        <StatusChip status={status} />
      </div>

      <div className="border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">
        <ExecutionPath entry={entry} />
      </div>

      {hasContent(entry.input) ? (
        <Payload label="Input" value={entry.input} />
      ) : null}

      {status === "error" && error ? (
        <div className="border-t border-border/70 bg-danger-soft/60 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
            {error.code}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{error.message}</p>
          {error.retry && error.retry !== "no" ? (
            <p className="mt-0.5 text-[11px] text-faint-foreground">retry: {error.retry}</p>
          ) : null}
        </div>
      ) : null}

      {status === "ok" && hasContent(entry.result) ? (
        <Payload label="Result" value={unwrapResult(entry.result)} />
      ) : null}
    </div>
  );
}

function ExecutionPath({ entry }: { entry: ToolEntry }) {
  if (entry.plane === "view") {
    return <span>Runs in this browser tab — changes only what you currently see.</span>;
  }
  if (entry.executor === "server") {
    return <span>Runs on the server inside the agent loop — reads application data.</span>;
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Globe aria-hidden className="h-3 w-3" />
      Browser → authenticated oRPC → server. Changes persistent data; the server re-checks
      authorization.
    </span>
  );
}

function StatusChip({ status }: { status: "running" | "ok" | "error" }) {
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Spinner className="h-3 w-3" label="Tool running" />
        running
      </span>
    );
  }
  if (status === "ok") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <Check aria-hidden className="h-3.5 w-3.5" />
        ok
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
      <AlertTriangle aria-hidden className="h-3.5 w-3.5" />
      failed
    </span>
  );
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="group border-t border-border/70 px-3 py-1.5">
      <summary className="cursor-pointer select-none text-[11px] text-faint-foreground hover:text-muted-foreground">
        {label}
      </summary>
      <pre className="dpas-scroll mt-1 max-h-40 overflow-auto rounded bg-surface-muted p-2 font-mono text-[11px] leading-4">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function hasContent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "object" && Object.keys(value as object).length === 0) return false;
  return true;
}

function unwrapResult(value: unknown): unknown {
  return value;
}

function extractError(entry: ToolEntry):
  | { code: string; message: string; retry?: string }
  | null {
  const value = entry.result;
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error: { code?: string; message?: string; retry?: string } }).error;
    return {
      code: error.code ?? "ERROR",
      message: error.message ?? "The call failed.",
      ...(error.retry ? { retry: error.retry } : {}),
    };
  }
  if (entry.status === "error") {
    return { code: "ERROR", message: "The call failed." };
  }
  return null;
}
