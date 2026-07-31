"use client";

import { currentCatalogMode } from "@/agent/host/catalog-mode";
import { currentPathname } from "@/agent/host/toolset";
import { PROTOCOL_VERSION } from "@/agent/host/protocol";
import { scopeForRoute } from "@/agent/host/scope";
import { useInspectorStore } from "@/agent/inspector/inspector-store";
import { useMessageStore, type ChatEntry } from "./message-store";

/**
 * A copy-pasteable account of what just happened, for bug reports.
 *
 * The failures worth reporting are almost never visible in the answer text —
 * they are in which capability was called, under which id, with what input,
 * and what came back. So this leads with the tool calls and carries the
 * context needed to reproduce: catalog mode, route scope, protocol version,
 * and the host/runtime trace.
 *
 * Truncates values rather than emitting an unpasteable wall, and says so where
 * it does.
 */

const MAX_VALUE_CHARS = 800;
const MAX_TEXT_CHARS = 2_000;
const MAX_EVENTS = 120;

function code(value: unknown): string {
  if (value === undefined) return "—";
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
  if (text === undefined) return "—";
  return text.length > MAX_VALUE_CHARS
    ? `${text.slice(0, MAX_VALUE_CHARS)}\n… truncated, ${text.length - MAX_VALUE_CHARS} more chars`
    : text;
}

function clip(text: string, max = MAX_TEXT_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}… (${text.length - max} more chars)` : text;
}

function renderEntry(entry: ChatEntry): string {
  switch (entry.kind) {
    case "user":
      return `### 👤 User\n\n${clip(entry.text)}`;
    case "assistant":
      return `### 🤖 Assistant\n\n${clip(entry.text)}`;
    case "reasoning":
      return `### 💭 Reasoning\n\n${clip(entry.text)}`;
    case "note":
      return `> **[${entry.tone}]** ${clip(entry.text, 500)}`;
    case "tool": {
      const status =
        entry.status === "ok" ? "✅ ok" : entry.status === "error" ? "❌ failed" : "⏳ running";
      return [
        `### 🔧 ${entry.canonicalId} — ${status}`,
        "",
        `- wire name: \`${entry.wireName}\``,
        `- plane: ${entry.plane} · executor: ${entry.executor}`,
        `- tool call id: \`${entry.toolCallId}\``,
        "",
        "Input:",
        "```json",
        code(entry.input),
        "```",
        "",
        "Result:",
        "```json",
        code(entry.result),
        "```",
      ].join("\n");
    }
  }
}

export function buildConversationReport(): string {
  const store = useMessageStore.getState();
  const trace = useInspectorStore.getState();
  const pathname = currentPathname();
  const scope = scopeForRoute(pathname);

  const toolCalls = store.entries.filter((e) => e.kind === "tool");
  const failures = toolCalls.filter((e) => e.kind === "tool" && e.status === "error");

  const header = [
    "# DPAS conversation report",
    "",
    "| | |",
    "|---|---|",
    `| Conversation | \`${store.conversationId}\` |`,
    `| Catalog mode | **${currentCatalogMode()}** |`,
    `| Route | \`${pathname}\` |`,
    `| Scope | ${scope.length > 0 ? scope.map((s) => `\`${s}\``).join(", ") : "_unscoped_"} |`,
    `| Protocol | v${PROTOCOL_VERSION} |`,
    `| Running | ${store.running} |`,
    `| Entries | ${store.entries.length} (${toolCalls.length} tool calls, ${failures.length} failed) |`,
    `| User agent | ${typeof navigator === "undefined" ? "—" : navigator.userAgent} |`,
  ].join("\n");

  // Failures first: a report is usually about one, and it should not have to
  // be hunted for in the transcript.
  const failureSummary =
    failures.length > 0
      ? [
          "",
          "## Failures",
          "",
          ...failures.map((entry) => {
            if (entry.kind !== "tool") return "";
            const err = (entry.result as { error?: { code?: string; message?: string } } | undefined)
              ?.error;
            return `- \`${entry.canonicalId}\` (${entry.wireName}) — **${err?.code ?? "unknown"}**: ${err?.message ?? "no message"}`;
          }),
        ].join("\n")
      : "";

  const conversation = ["", "## Conversation", "", store.entries.map(renderEntry).join("\n\n")].join(
    "\n",
  );

  const events = trace.events.slice(-MAX_EVENTS);
  const traceSection = [
    "",
    `## Trace (last ${events.length} of ${trace.events.length})`,
    "",
    "```",
    ...events.map(
      (e) =>
        `${e.at} [${e.lane}] ${e.type}${e.status ? ` (${e.status})` : ""} — ${e.summary}` +
        (e.durationMs !== undefined ? ` · ${e.durationMs}ms` : ""),
    ),
    "```",
  ].join("\n");

  const catalog =
    trace.domainCatalog.length > 0
      ? [
          "",
          "## Catalog at last step",
          "",
          ...trace.domainCatalog.map(
            (row) =>
              `- \`${row.canonicalId}\` — ${row.plane}/${row.kind}, ${row.available ? "available" : `unavailable: ${row.unavailableReason ?? "no reason given"}`}`,
          ),
        ].join("\n")
      : "";

  return [header, failureSummary, conversation, catalog, traceSection]
    .filter((section) => section.length > 0)
    .join("\n");
}

/**
 * Copies the report, falling back to a textarea + `execCommand` where the
 * async clipboard is unavailable — it needs a secure context, and this app is
 * routinely run over plain http on a LAN address.
 */
export async function copyConversationReport(): Promise<boolean> {
  const report = buildConversationReport();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(report);
      return true;
    }
  } catch {
    // Fall through to the legacy path rather than failing silently.
  }
  try {
    const area = document.createElement("textarea");
    area.value = report;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
