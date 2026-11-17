<script setup lang="ts">
import { withBase } from "vitepress";

import PlaneMark from "./PlaneMark.vue";

type Row = {
  claim: string;
  detail: string;
  planes: ("view" | "domain")[];
  evidence: { text: string; link: string };
};

const rows: Row[] = [
  {
    claim: "Deterministic discoverability",
    detail:
      "The catalog is composed per request from identity, route and mounted components: computed, not prompted. Both planes compile to committed inventory files, so what the model can see changes only when you change it, in a diff a reviewer can read.",
    planes: ["view", "domain"],
    evidence: {
      text: "ADR-0011 · Compiled capability contracts",
      link: "/adr/0011-compiled-capability-contracts",
    },
  },
  {
    claim: "Governance that holds up to audit",
    detail:
      "Authorization runs on the server on every call. A capability the current identity lacks does not grey out; it disappears. Consequential mutations return an approval card, and nothing moves until a human decides.",
    planes: ["domain"],
    evidence: { text: "Security model", link: "/security/model" },
  },
  {
    claim: "An agent host you own",
    detail:
      "The browser↔server protocol, per-request catalog composition, executor routing, correlation ids and run limits are application modules you can read and change, not framework glue.",
    planes: [],
    evidence: { text: "Host protocol", link: "/reference/host-protocol" },
  },
  {
    claim: "Deterministic tests, no LLM",
    detail:
      "Governance and capability contracts are unit-tested, and Playwright drives a production build through the live pipeline under a scripted model: the real host, the real approval flow, no provider key. CI never needs credentials.",
    planes: ["view", "domain"],
    evidence: { text: "Testing without an LLM", link: "/guides/testing" },
  },
];

const PLANE_NAME = { view: "view plane", domain: "domain plane" } as const;
</script>

<template>
  <section class="dh-section" aria-labelledby="dh-ledger-title">
    <header class="dh-head">
      <p class="dh-eyebrow">guarantees</p>
      <h2 id="dh-ledger-title" class="dh-h2">What holds, and where it is written down</h2>
    </header>

    <ol class="dh-ledger">
      <li v-for="(row, i) in rows" :key="row.claim" class="dh-ledger-row">
        <span class="dh-ledger-n" aria-hidden="true">{{ String(i + 1).padStart(2, "0") }}</span>
        <div class="dh-ledger-claim">
          <h3 class="dh-h3">{{ row.claim }}</h3>
          <p v-if="row.planes.length" class="dh-ledger-planes">
            <span v-for="plane in row.planes" :key="plane" :title="PLANE_NAME[plane]">
              <PlaneMark :plane="plane" /><span class="dh-sr">{{ PLANE_NAME[plane] }}</span>
            </span>
          </p>
        </div>
        <p class="dh-ledger-detail">{{ row.detail }}</p>
        <a class="dh-ledger-evidence" :href="withBase(row.evidence.link)">
          <span class="dh-ledger-evidence-label">evidence →</span>
          <span>{{ row.evidence.text }}</span>
        </a>
      </li>
    </ol>
  </section>
</template>
