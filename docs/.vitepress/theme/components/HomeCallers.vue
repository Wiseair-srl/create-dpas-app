<script setup lang="ts">
import { withBase } from "vitepress";

import PlaneMark from "./PlaneMark.vue";

/**
 * Trimmed from templates/default/capabilities/invoices/issue-invoice.ts: the
 * audit middleware and the handler body are elided, everything else is
 * verbatim. Tokens carry a class for monochrome emphasis and, on the
 * `expose` keys, the number of the caller they admit.
 */
type Token = { t: string; c?: "k" | "s" | "c" | "key"; n?: number };
type Line = { tokens: Token[]; mark?: boolean };

const code: Line[] = [
  { tokens: [{ t: "export const ", c: "k" }, { t: "issueInvoice = agentBase" }] },
  { tokens: [{ t: "  .meta({" }] },
  { tokens: [{ t: "    agent: {" }] },
  { tokens: [{ t: "      description:" }] },
  {
    tokens: [
      {
        t: '        "Issue a draft invoice: send it to the client and enter it in the receivables ledger. "',
        c: "s",
      },
      { t: " +" },
    ],
  },
  {
    tokens: [
      {
        t: '        "Irreversible. Requires the user\'s approval when a model asks for it."',
        c: "s",
      },
      { t: "," },
    ],
  },
  {
    mark: true,
    tokens: [
      { t: "      expose: { " },
      { t: "aiSdk", c: "key", n: 2 },
      { t: ": true, " },
      { t: "mcp", c: "key", n: 3 },
      { t: ": true, " },
      { t: "direct", c: "key", n: 1 },
      { t: ": true, test: true }," },
    ],
  },
  { tokens: [{ t: "      sideEffect: " }, { t: '"destructive"', c: "s" }, { t: "," }] },
  { tokens: [{ t: "      risk: " }, { t: '"high"', c: "s" }, { t: "," }] },
  { tokens: [{ t: "      tags: [" }, { t: '"invoices"', c: "s" }, { t: "]," }] },
  { tokens: [{ t: "    }," }] },
  { tokens: [{ t: "  })" }] },
  { tokens: [{ t: "  .input(invoiceId)" }] },
  { tokens: [{ t: "  .handler(({ input }) => { " }, { t: "/* … */", c: "c" }, { t: " });" }] },
];
</script>

<template>
  <section class="dh-section" aria-labelledby="dh-callers-title">
    <header class="dh-head">
      <p class="dh-eyebrow">expose · direct · aiSdk · mcp</p>
      <h2 id="dh-callers-title" class="dh-h2">One declaration, three callers</h2>
      <p class="dh-lede">
        A capability is a single typed declaration. No tool wrappers mirroring your procedures, no
        second schema to keep in sync, no product that drifts from the agent's view of it.
      </p>
    </header>

    <div class="dh-callers">
      <figure class="dh-code">
        <figcaption class="dh-code-caption">
          <span class="dh-tag dh-tag--domain"><PlaneMark plane="domain" />domain · server</span>
          <span class="dh-code-path">capabilities/invoices/issue-invoice.ts</span>
        </figcaption>
        <pre
          class="dh-code-pre"
        ><code><span v-for="(line, i) in code" :key="i" class="dh-code-line" :class="{ 'dh-code-line--mark': line.mark }"><span v-for="(tok, j) in line.tokens" :key="j" :class="tok.c ? `dh-tok-${tok.c}` : undefined" :data-n="tok.n">{{ tok.t }}</span></span></code></pre>
      </figure>

      <ol class="dh-caller-list">
        <li class="dh-caller">
          <span class="dh-caller-n" aria-hidden="true">1</span>
          <code class="dh-caller-key">direct</code>
          <p><strong>The UI calls it directly.</strong> The app's own Issue button.</p>
        </li>
        <li class="dh-caller">
          <span class="dh-caller-n" aria-hidden="true">2</span>
          <code class="dh-caller-key">aiSdk</code>
          <p><strong>The copilot receives it through the host.</strong></p>
        </li>
        <li class="dh-caller">
          <span class="dh-caller-n" aria-hidden="true">3</span>
          <code class="dh-caller-key">mcp</code>
          <p><strong>External clients get it over MCP.</strong></p>
        </li>
      </ol>
    </div>

    <p class="dh-foot">
      <a class="dh-link" :href="withBase('/concepts/capabilities')">Anatomy of a capability →</a>
    </p>
  </section>
</template>
