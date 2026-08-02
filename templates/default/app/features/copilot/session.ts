import { useCallback, useEffect, useMemo, useState } from "react";

import type { WireModelMessage } from "@/agent/host/protocol";

import { useMessageStore, type TokenUsage } from "./experience/message-store";
import { entriesFromModelMessages } from "./experience/rehydrate";
import type { ApprovalCardData } from "./tool-ui";

/**
 * Everything a copilot surface needs, independent of where it is rendered.
 *
 * There are two surfaces over ONE conversation: the docked panel (available on
 * every screen) and the full-page view at /chat (which adds the thread rail).
 * The conversation itself lives in the module-scoped message store, so it
 * survives navigation and is the same in both — this hook only supplies the
 * server-backed bits around it.
 *
 * Exactly one surface may be mounted at a time; the dock hides itself on
 * /chat. Two mounts would double the polling below and stand up two runtimes
 * over the same store.
 */

export interface ThreadMeta {
  id: string;
  title: string;
  createdAt: string;
  /** What the thread has cost. Absent when it never measured anything. */
  usage?: TokenUsage;
}

const json = (r: Response) => {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
};

export interface CopilotSession {
  threads: ThreadMeta[];
  approvals: ApprovalCardData[];
  models: string[];
  model: string;
  setModel: (model: string) => void;
  conversationId: string;
  loadingThread: boolean;
  openThread: (id: string) => Promise<void>;
  newThread: () => void;
  refresh: () => void;
  /** Context value for `CopilotProvider` — stable across renders. */
  copilot: {
    approvals: ApprovalCardData[];
    threadId: string;
    onDecided: () => void;
  };
}

export function useCopilotSession(): CopilotSession {
  const [threads, setThreads] = useState<ThreadMeta[]>([]);
  const [approvals, setApprovals] = useState<ApprovalCardData[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);

  const conversationId = useMessageStore((s) => s.conversationId);
  const model = useMessageStore((s) => s.modelId);
  const setModel = useMessageStore((s) => s.setModelId);
  const loadThread = useMessageStore((s) => s.loadThread);
  const newThread = useMessageStore((s) => s.newThread);
  const running = useMessageStore((s) => s.running);

  const refresh = useCallback(() => {
    void Promise.all([
      fetch("/api/threads", { credentials: "include" }).then(json).catch(() => []),
      fetch("/api/approvals", { credentials: "include" }).then(json).catch(() => []),
    ]).then(([t, a]) => {
      setThreads(t);
      setApprovals(a);
    });
  }, []);

  useEffect(() => {
    fetch("/api/session", { credentials: "include" })
      .then(json)
      .then((info: { models?: string[]; defaultModel?: string }) => {
        // Defaulted rather than trusted. `models` drives `liveEnabled`, and a
        // response that omits it would otherwise take the whole surface down
        // on `.length` — a config endpoint must not be able to blank the app.
        const available = Array.isArray(info.models) ? info.models : [];
        setModels(available);
        // Only seeds the picker; the server re-checks whatever is sent against
        // its own allowlist on every step.
        if (!useMessageStore.getState().modelId) {
          setModel(info.defaultModel || available[0] || "");
        }
      })
      .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => clearInterval(timer);
  }, [refresh, setModel]);

  // A finished turn may have created a thread, renamed one, or opened an
  // approval — all of which the rail and the approval cards read.
  useEffect(() => {
    if (running === "idle") refresh();
  }, [running, refresh]);

  /**
   * Open a stored thread. The model history is authoritative and the rendered
   * entries are derived from it, so what a thread shows and what the next turn
   * reasons over cannot drift apart.
   *
   * The token total is fetched alongside it rather than read off `threads`:
   * that list is polled on a timer, and the counter has to be the thread's
   * real figure at the moment it opens, not whatever the last poll saw.
   */
  const openThread = useCallback(
    async (id: string) => {
      setLoadingThread(true);
      try {
        const [messages, meta] = await Promise.all([
          fetch(`/api/threads/${id}/model-messages`, { credentials: "include" })
            .then(json)
            .catch(() => []) as Promise<WireModelMessage[]>,
          // A thread whose metadata failed to load still opens — the
          // transcript is the point, and a missing counter hides itself.
          fetch(`/api/threads/${id}`, { credentials: "include" })
            .then(json)
            .catch(() => ({})) as Promise<Partial<ThreadMeta>>,
        ]);
        loadThread({
          conversationId: id,
          entries: entriesFromModelMessages(messages),
          modelMessages: messages,
          ...(meta.usage ? { usage: meta.usage } : {}),
        });
      } finally {
        setLoadingThread(false);
      }
    },
    [loadThread],
  );

  const copilot = useMemo(
    () => ({
      approvals,
      threadId: conversationId,
      onDecided: () => {
        refresh();
        void openThread(conversationId);
      },
    }),
    [approvals, conversationId, refresh, openThread],
  );

  return {
    threads,
    approvals,
    models,
    model,
    setModel,
    conversationId,
    loadingThread,
    openThread,
    newThread,
    refresh,
    copilot,
  };
}
