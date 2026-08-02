import { AssistantRuntimeProvider } from "@assistant-ui/react";

import { useDpasAssistantRuntime } from "./experience/runtime-adapter";
import { Thread } from "./Thread";
import { CopilotProvider } from "./tool-ui";
import type { CopilotSession } from "./session";

/**
 * One conversation, two shells: the docked panel and the full-page view. Both
 * render this. The runtime is an assistant-ui *external store* adapter over the
 * module-scoped message store, so mounting it here rather than app-wide costs
 * nothing and keeps the two surfaces from ever disagreeing about state.
 */
export function CopilotSurface({
  session,
  compact = false,
}: {
  session: CopilotSession;
  compact?: boolean;
}) {
  // No configured provider means no live turn: the composer stays inert rather
  // than posting a step the server would answer with MODEL_NOT_CONFIGURED.
  const runtime = useDpasAssistantRuntime({ liveEnabled: session.models.length > 0 });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <CopilotProvider value={session.copilot}>
        {/* The empty-conversation and composer states inside Thread already
            cover the no-key case (NoModelSetup + disabled composer) — a
            second banner here would say the same thing twice above it. */}
        <Thread
          models={session.models}
          model={session.model}
          onModelChange={session.setModel}
          compact={compact}
        />
      </CopilotProvider>
    </AssistantRuntimeProvider>
  );
}
