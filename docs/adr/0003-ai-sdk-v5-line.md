# ADR-0003 — Pin the AI SDK to the v5 line

**Status:** accepted · 2026-07-30

`@orpc-agent/ai-sdk@1.0.0` (the only published line) peers on `ai@^5` and is
dev-tested against `^5.0.220`. `@mastra/core@1.54` is provider-version
agnostic (it ships v5/v6/v7 provider shims), so it accepts `ai@5` tool objects
and a hand-written `LanguageModelV2`. The template therefore uses `ai@^5.0.223`
everywhere. Revisit when orpc-agent publishes an adapter for a newer `ai`
major; the host protocol (ADR-0002) already isolates the browser from this
choice entirely.
