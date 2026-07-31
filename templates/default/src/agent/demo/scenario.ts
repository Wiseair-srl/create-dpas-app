"use client";

import { encodeWireName } from "@agent-surface/core";
import { currentPathname, getHostToolset } from "@/agent/host/toolset";
import { frontendResultToModelValue } from "@/agent/host/errors";
import { newTurnId } from "@/agent/host/identity";
import { inspector } from "@/agent/inspector/inspector-store";
import { useMessageStore } from "@/agent/experience/message-store";

/**
 * The guided deterministic demo (golden scenario). No model anywhere — a
 * scripted runner drives the SAME pipeline live mode uses:
 *
 *   Agent Surface registry → host toolset → capability execution →
 *   confirmation controller → authenticated oRPC → server authorization →
 *   React Query reconciliation → Agent Inspector.
 *
 * Nothing is animated or faked: if you deny the confirmation, nothing is
 * disabled, and the demo says so.
 */

export const GOLDEN_PROMPT =
  "Show me the offline devices in Milan, select the visible devices, and disable them.";

const STEP_PAUSE_MS = 450;

interface StepResult {
  ok: boolean;
  value: unknown;
}

let demoCounter = 0;

export async function runGuidedDemo(signal: AbortSignal): Promise<void> {
  const store = useMessageStore.getState();
  if (store.running !== "idle") return;
  store.setRunning("demo");
  const turnId = newTurnId();

  const say = (text: string) => useMessageStore.getState().appendAssistantText(text);
  const note = (tone: "demo" | "info" | "error", text: string) =>
    useMessageStore.getState().appendNote(tone, text);

  const pause = () =>
    new Promise<void>((resolve) => setTimeout(resolve, STEP_PAUSE_MS));

  const exec = async (canonicalId: string, input: unknown): Promise<StepResult> => {
    // Pinned to direct mode on purpose. The guided demo is a scripted local
    // walkthrough — it names capabilities itself and never involves a model —
    // so it resolves tools by encoded capability name. Meta mode projects three
    // generic tools instead, and none of those names would match. The catalog
    // mode toggle shapes what a MODEL is offered in live chat; it has nothing
    // to demonstrate here.
    const toolset = getHostToolset(currentPathname(), "direct");
    const wireName = encodeWireName(canonicalId);
    const tool = toolset
      .tools()
      .find((t) => t.name === wireName || t.name.startsWith(`${wireName}_at_`));
    const toolCallId = `demo_${++demoCounter}`;
    const plane = canonicalId.startsWith("domain:") ? ("domain" as const) : ("view" as const);

    useMessageStore.getState().upsertToolCall({
      toolCallId,
      wireName,
      canonicalId,
      plane,
      executor: "browser",
      input,
    });
    inspector.push({
      lane: "host",
      type: "demo-dispatch",
      status: "pending",
      summary: `guided demo → ${canonicalId}`,
      correlation: { turnId, toolCallId, invocationId: toolCallId, capabilityId: canonicalId },
    });

    if (!tool) {
      const value = {
        error: {
          code: "CAPABILITY_NOT_FOUND",
          message: `${canonicalId} is not on the current surface for this identity.`,
          retry: "no",
        },
      };
      useMessageStore.getState().settleToolCall(toolCallId, false, value);
      return { ok: false, value };
    }

    const result = await tool.execute(input as never, { toolCallId });
    const model = frontendResultToModelValue(result);
    useMessageStore.getState().settleToolCall(toolCallId, model.ok, model.value);
    return { ok: model.ok, value: model.value };
  };

  const readTableState = async (): Promise<{
    ok: boolean;
    rows: Array<{ id: string; name: string; disabled: boolean }>;
  }> => {
    // Give React a beat to commit filter/selection changes before reading.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const result = await exec("view:devices.table.readState", {});
    if (!result.ok) return { ok: false, rows: [] };
    const value = result.value as {
      visibleRows?: Array<{ id: string; name: string; disabled: boolean }>;
    };
    return { ok: true, rows: value.visibleRows ?? [] };
  };

  try {
    useMessageStore.getState().appendUser(GOLDEN_PROMPT);
    note(
      "demo",
      "Guided demo: a deterministic scenario runner is driving the real capability " +
        "pipeline — Agent Surface, the Agent Host, confirmation, and the oRPC procedure. " +
        "No AI model is involved.",
    );
    if (signal.aborted) return;

    say("I'll filter the table to offline devices in Milan.");
    await pause();
    const filtered = await exec("view:devices.filters.set", { status: "offline", city: "Milan" });
    if (!filtered.ok || signal.aborted) {
      if (!filtered.ok) note("error", "Could not set filters — is the dashboard open?");
      return;
    }

    await pause();
    const table = await readTableState();
    if (!table.ok || signal.aborted) return;
    if (table.rows.length === 0) {
      say(
        "There are no offline devices in Milan right now — nothing to disable. " +
          "Reset the demo data (header button) and run the demo again.",
      );
      return;
    }

    say(
      `${table.rows.length} offline device${table.rows.length === 1 ? " is" : "s are"} visible. ` +
        "Selecting them.",
    );
    await pause();
    const selected = await exec("view:devices.table.selectRows", {
      ids: table.rows.map((row) => row.id),
      mode: "replace",
    });
    if (!selected.ok || signal.aborted) return;

    note(
      "info",
      "Selecting rows just made domain:devices.disable available. Until now it was in the " +
        'catalog but unavailable — "Select at least one device first". State discloses.',
    );
    await pause();

    say("Disabling the selected devices — this needs your confirmation.");
    await pause();
    const disabled = await exec("domain:devices.disable", {});

    if (signal.aborted) return;

    if (!disabled.ok) {
      const code = (disabled.value as { error?: { code?: string } }).error?.code;
      if (code === "CONFIRMATION_INVALID") {
        say("You declined the confirmation, so nothing was disabled. The selection is unchanged.");
      } else if (code === "CAPABILITY_NOT_FOUND") {
        note(
          "error",
          "domain:devices.disable is hidden for the viewer role (authority hides). " +
            "Switch to Olivia — operator and run the demo again.",
        );
      } else {
        say(`The disable call failed (${code ?? "unknown error"}). Nothing was changed.`);
      }
      return;
    }

    const outcome = disabled.value as { disabled?: number };
    await pause();
    const after = await readTableState();
    const stillActive = after.rows.filter((row) => !row.disabled).length;
    say(
      `Done — the server disabled ${outcome.disabled ?? 0} device${
        (outcome.disabled ?? 0) === 1 ? "" : "s"
      }, and the table reconciled through the normal data layer` +
        (after.ok ? ` (${stillActive} of the visible rows remain active).` : "."),
    );
    note("demo", "Open the Inspector tab to follow the correlated trace of this run.");
  } finally {
    useMessageStore.getState().setRunning("idle");
    inspector.push({
      lane: "experience",
      type: "demo-finished",
      status: "info",
      summary: "guided demo finished",
      correlation: { turnId },
    });
  }
}
