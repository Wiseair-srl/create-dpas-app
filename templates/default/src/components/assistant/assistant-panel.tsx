"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  Bot,
  Check,
  ClipboardCopy,
  KeyRound,
  Play,
  RotateCcw,
  ScanSearch,
  Settings2,
  Square,
} from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useAppConfig } from "@/lib/use-app-config";
import { runGuidedDemo, GOLDEN_PROMPT } from "@/agent/demo/scenario";
import { ConfirmationCard } from "@/agent/experience/confirmation-card";
import { useMessageStore } from "@/agent/experience/message-store";
import { copyConversationReport } from "@/agent/experience/conversation-report";
import { useDpasAssistantRuntime } from "@/agent/experience/runtime-adapter";
import { startLiveTurn, cancelActiveTurn } from "@/agent/experience/turn-controller";
import { InspectorPanel } from "@/components/agent-inspector/inspector-panel";
import { ModelSettingsDialog } from "./model-settings";
import { CatalogModeToggle } from "./catalog-mode-toggle";
import { AssistantComposer, AssistantThread } from "./thread";
import { TokenCounter } from "./token-counter";

/**
 * The assistant panel: chat (live model and/or guided demo) plus the Agent
 * Inspector. assistant-ui renders the conversation; every decision about what
 * the agent may do lives in the capability providers, not here.
 */
export function AssistantPanel() {
  const [tab, setTab] = useState<"chat" | "inspector">("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const config = useAppConfig();
  const running = useMessageStore((state) => state.running);
  const resetThread = useMessageStore((state) => state.reset);
  const demoAbort = useRef<AbortController | null>(null);

  const live = config.data?.live ?? false;
  const canConnect = config.data?.runtimeConfigurable ?? false;
  const runtime = useDpasAssistantRuntime({ liveEnabled: live });

  const startDemo = () => {
    const controller = new AbortController();
    demoAbort.current = controller;
    void runGuidedDemo(controller.signal);
  };

  const stop = () => {
    demoAbort.current?.abort();
    cancelActiveTurn();
  };

  return (
    <section
      aria-label="Assistant"
      className="flex h-full min-h-0 flex-col bg-surface"
      data-testid="assistant-panel"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Bot aria-hidden className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold">Assistant</h2>
        <Badge variant={live ? "view" : "neutral"} data-testid="assistant-mode">
          {config.data?.label ?? "…"}
        </Badge>
        <div className="ml-auto">
          <CatalogModeToggle />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          aria-label="Model settings"
          title="Model settings"
          data-testid="open-model-settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 aria-hidden className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1" role="tablist" aria-label="Assistant panels">
          <TabButton active={tab === "chat"} onClick={() => setTab("chat")} id="chat">
            Chat
          </TabButton>
          <TabButton active={tab === "inspector"} onClick={() => setTab("inspector")} id="inspector">
            <ScanSearch aria-hidden className="h-3.5 w-3.5" />
            Inspector
          </TabButton>
        </div>
      </header>

      {tab === "inspector" ? (
        <InspectorPanel />
      ) : (
        <AssistantRuntimeProvider runtime={runtime}>
          <div className="flex min-h-0 flex-1 flex-col">
            <AssistantThread
              welcome={
                <Welcome
                  live={live}
                  onGolden={() => {
                    if (live) void startLiveTurn(GOLDEN_PROMPT);
                    else startDemo();
                  }}
                  onDemo={startDemo}
                />
              }
            />
            <div className="shrink-0 space-y-2 px-3 pb-1">
              <ConfirmationCard />
              <DemoBar
                running={running}
                onStart={startDemo}
                onStop={stop}
                onReset={resetThread}
              />
            </div>
            {live ? (
              <AssistantComposer
                disabled={running !== "idle"}
                running={running === "live"}
                placeholder='Try: "disable the offline devices in Milan"'
                onStop={stop}
              />
            ) : (
              <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
                <p className="flex-1 text-[11px] leading-4 text-muted-foreground">
                  {canConnect
                    ? "Free-form chat needs a model. Connect an OpenRouter key — the guided demo works without one."
                    : "Free-form chat needs a model: set MODEL_PROVIDER and an API key in .env, then restart. The guided demo works without any of that."}
                </p>
                {canConnect ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setSettingsOpen(true)}
                    data-testid="connect-model"
                  >
                    <KeyRound aria-hidden className="h-3.5 w-3.5" />
                    Connect
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </AssistantRuntimeProvider>
      )}

      <ModelSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </section>
  );
}

function TabButton({
  active,
  onClick,
  id,
  children,
}: {
  active: boolean;
  onClick: () => void;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      id={`assistant-tab-${id}`}
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-xs font-medium",
        active
          ? "bg-surface-muted text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Welcome({
  live,
  onGolden,
  onDemo,
}: {
  live: boolean;
  onGolden: () => void;
  onDemo: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted/50 p-4">
      <h3 className="text-sm font-semibold">Operate the dashboard by asking</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        The assistant sees this page as semantic capabilities: view tools that change what you see,
        and governed domain tools on the server. Destructive actions always come back to you for
        confirmation.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <button
          onClick={onGolden}
          data-testid="golden-suggestion"
          className="rounded-md border border-border bg-surface px-3 py-2 text-left text-xs hover:border-accent hover:text-accent"
        >
          “{GOLDEN_PROMPT}”
        </button>
        {live ? (
          <button
            onClick={onDemo}
            className="rounded-md border border-dashed border-border px-3 py-2 text-left text-xs text-muted-foreground hover:border-accent hover:text-accent"
          >
            …or watch the deterministic guided demo (no model)
          </button>
        ) : null}
      </div>
    </div>
  );
}

function DemoBar({
  running,
  onStart,
  onStop,
  onReset,
}: {
  running: "idle" | "live" | "demo";
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
}) {
  return (
    // Wraps rather than clips: the assistant panel is resizable down to 340px,
    // where these four controls no longer fit on one line.
    <div className="flex flex-wrap items-center gap-2">
      {running === "idle" ? (
        <>
          <Button size="sm" variant="secondary" onClick={onStart} data-testid="run-guided-demo">
            <Play aria-hidden className="h-3.5 w-3.5" />
            Run guided demo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            className="text-muted-foreground"
            title="Clear the conversation"
          >
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            Clear
          </Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" onClick={onStop} data-testid="stop-run">
          <Square aria-hidden className="h-3 w-3 fill-current" />
          Stop {running === "demo" ? "demo" : "run"}
        </Button>
      )}
      {/* Both stay available mid-run: a run that is looping is exactly the one
          worth counting and capturing, and waiting for it to finish loses the
          state. */}
      <div className="ml-auto flex min-w-0 items-center gap-1">
        <TokenCounter />
        <CopyConversationButton />
      </div>
    </div>
  );
}

/**
 * Copies the conversation, the tool calls with their inputs and results, the
 * catalog mode and scope, and the recent trace — the things a bug report needs
 * and a screenshot cannot carry.
 */
function CopyConversationButton() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const entries = useMessageStore((s) => s.entries.length);

  const copy = async () => {
    const ok = await copyConversationReport();
    setState(ok ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 2000);
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={copy}
      disabled={entries === 0}
      className="text-muted-foreground"
      title="Copy the conversation, tool calls and trace as Markdown"
      data-testid="copy-conversation"
    >
      {state === "copied" ? (
        <Check aria-hidden className="h-3.5 w-3.5 text-ok" />
      ) : (
        <ClipboardCopy aria-hidden className="h-3.5 w-3.5" />
      )}
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </Button>
  );
}
