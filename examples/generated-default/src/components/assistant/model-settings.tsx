"use client";

import { CheckCircle2, KeyRound, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import {
  useAppConfig,
  useConnectModel,
  useDisconnectModel,
  useTestModelKey,
  type AppConfig,
} from "@/lib/use-app-config";

/**
 * Connect a live model without touching .env.
 *
 * The key is posted once to the server, held in that process's memory, and
 * used only to build the Mastra model. It is never returned to the browser
 * (only a masked hint), never written to disk, and never enters a client
 * bundle — the agent loop runs server-side, so the browser never needs it.
 */

const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";

export function ModelSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const config = useAppConfig();
  const connect = useConnectModel();
  const disconnect = useDisconnectModel();
  const test = useTestModelKey();

  const [apiKey, setApiKey] = useState("");
  const [modelId, setModelId] = useState(DEFAULT_MODEL);

  const data = config.data;
  const connected = data?.runtime ?? null;
  const disabledHere = data ? !data.runtimeConfigurable : false;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    connect.mutate(
      { provider: "openrouter", apiKey: apiKey.trim(), modelId: modelId.trim() || DEFAULT_MODEL },
      { onSuccess: () => setApiKey("") },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="model-settings">
        <DialogHeader
          title="Connect a model"
          description="Use an OpenRouter key to enable free-form chat. The guided demo never needs one."
          icon={<KeyRound aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-accent" />}
        />

        {disabledHere ? (
          <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
            Runtime configuration is disabled in this environment, because the key would be shared
            by every visitor of this process. Set <code className="font-mono">MODEL_PROVIDER</code>{" "}
            and a key in <code className="font-mono">.env</code>, or start with{" "}
            <code className="font-mono">ALLOW_RUNTIME_MODEL_KEY=true</code>.
          </p>
        ) : connected ? (
          <ConnectedState
            config={data!}
            onDisconnect={() => disconnect.mutate()}
            disconnecting={disconnect.isPending}
            onTest={() => test.mutate()}
            testing={test.isPending}
            testResult={test.data ?? null}
          />
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field
              label="OpenRouter API key"
              hint={
                <>
                  Create one at{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline underline-offset-2 hover:text-accent"
                  >
                    openrouter.ai/keys
                  </a>
                  .
                </>
              }
            >
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                required
                minLength={16}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-or-v1-…"
                aria-label="OpenRouter API key"
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 font-mono text-sm placeholder:text-faint-foreground"
              />
            </Field>

            <Field
              label="Model"
              hint={
                <>
                  An OpenRouter id in <span className="font-mono">vendor/model</span> form. It must
                  support tool calling — “Test key” checks that for you once connected.
                </>
              }
            >
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
                aria-label="Model id"
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 font-mono text-sm"
              />
            </Field>

            {connect.error ? (
              <p role="alert" className="text-xs text-danger">
                {connect.error.message}
              </p>
            ) : null}

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground">
                <ShieldCheck aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
                Kept in server memory for this process only — never written to disk, never sent
                back to the browser.
              </p>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={connect.isPending || apiKey.trim().length < 16}
              >
                {connect.isPending ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
                Connect
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConnectedState({
  config,
  onDisconnect,
  disconnecting,
  onTest,
  testing,
  testResult,
}: {
  config: AppConfig;
  onDisconnect: () => void;
  disconnecting: boolean;
  onTest: () => void;
  testing: boolean;
  testResult: { ok: boolean; reason: string } | null;
}) {
  return (
    <div className="space-y-3" data-testid="model-connected">
      <dl className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs">
        <Row label="Provider">{config.label}</Row>
        <Row label="Model">
          <span className="font-mono">{config.runtime?.modelId}</span>
        </Row>
        <Row label="Key">
          <span className="font-mono">{config.runtime?.keyHint}</span>
        </Row>
      </dl>

      {testResult ? (
        <p
          role="status"
          className={cn(
            "flex items-center gap-1.5 text-xs",
            testResult.ok ? "text-success" : "text-warning",
          )}
        >
          {testResult.ok ? (
            <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
          ) : (
            <XCircle aria-hidden className="h-3.5 w-3.5" />
          )}
          {testResult.reason}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-4 text-muted-foreground">
          Free-form chat is live. Restarting the server clears this key.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : null}
            Test key
          </Button>
          <Button size="sm" variant="danger" onClick={onDisconnect} disabled={disconnecting}>
            Disconnect
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
