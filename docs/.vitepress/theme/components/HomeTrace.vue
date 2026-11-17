<script setup lang="ts">
import { withBase } from "vitepress";

import PlaneMark from "./PlaneMark.vue";

type Plane = "view" | "domain" | "none";
type Step = { plane: Plane; id?: string; gone?: boolean; text: string; note?: string };
type Act = { prompt: string; quoted?: boolean; steps: Step[] };

const PLANE_TAG: Record<Plane, string> = {
  view: "view · browser",
  domain: "domain · server",
  none: "model",
};

/** The demo run from Getting started, step for step. */
const acts: Act[] = [
  {
    prompt: "Which invoices are overdue, and by how much?",
    quoted: true,
    steps: [
      {
        plane: "domain",
        id: "domain:collections-aging",
        text: "Reads the ageing ladder on the server: a governed read, re-authorized, audited.",
      },
      {
        plane: "view",
        id: "view:invoices.pending.setFilters",
        text: "Narrows the table in your browser, and the URL moves with it. The agent called the same setter your toolbar calls.",
      },
      {
        plane: "view",
        id: "view:invoices.pending.readState",
        text: "Reads the rows back.",
      },
      {
        plane: "none",
        text: "Answers from what it read. It has no privileged channel into the UI.",
      },
    ],
  },
  {
    prompt: "Then ask it to issue a draft.",
    steps: [
      {
        plane: "domain",
        id: "domain:issue-invoice",
        text: "A model-initiated call comes back as an approval card. Nothing moves until you decide.",
        note: "approval card",
      },
    ],
  },
  {
    prompt: "Switch identity in the header to Ada, the analyst.",
    steps: [
      {
        plane: "domain",
        id: "domain:issue-invoice",
        gone: true,
        text: "Does not grey out: it disappears. Asking the server for it directly answers",
        note: "Capability not found",
      },
    ],
  },
];

let n = 0;
const numbered = acts.map((act) => ({
  ...act,
  steps: act.steps.map((step) => ({ ...step, n: String(++n).padStart(2, "0") })),
}));
</script>

<template>
  <section class="dh-section" aria-labelledby="dh-trace-title">
    <header class="dh-head">
      <p class="dh-eyebrow">pnpm dev · ⌘J</p>
      <h2 id="dh-trace-title" class="dh-h2">A run, traced</h2>
      <p class="dh-lede">
        Add a provider key, press ⌘J and ask. The architecture is visible in the order of events.
      </p>
    </header>

    <div class="dh-trace">
      <div class="dh-lanes" aria-hidden="true">
        <span></span>
        <span class="dh-lane dh-lane--view">View plane · browser</span>
        <span class="dh-lane dh-lane--domain">Domain plane · server</span>
      </div>

      <div v-for="(act, a) in numbered" :key="a" class="dh-act">
        <p class="dh-act-prompt">
          <span class="dh-act-who" aria-hidden="true">you ›</span>
          <span :class="{ 'dh-act-quote': act.quoted }">{{ act.prompt }}</span>
        </p>
        <ol class="dh-steps">
          <li
            v-for="step in act.steps"
            :key="step.n"
            class="dh-step"
            :class="`dh-step--${step.plane}`"
          >
            <span class="dh-step-n">{{ step.n }}</span>
            <div class="dh-step-body">
              <p class="dh-tag" :class="`dh-tag--${step.plane}`">
                <PlaneMark :plane="step.plane" />{{ PLANE_TAG[step.plane] }}
              </p>
              <code v-if="step.id" class="dh-step-id" :class="{ 'dh-step-id--gone': step.gone }">
                <span v-if="step.gone" class="dh-sr">removed: </span>{{ step.id }}
              </code>
              <p class="dh-step-text">
                {{ step.text }}
                <code v-if="step.gone && step.note">{{ step.note }}</code
                ><template v-if="step.gone">.</template>
              </p>
              <p v-if="step.note && !step.gone" class="dh-step-note">{{ step.note }}</p>
            </div>
          </li>
        </ol>
      </div>
    </div>

    <p class="dh-foot">
      <a class="dh-link" :href="withBase('/getting-started')">Run it yourself →</a>
      <a class="dh-link" :href="withBase('/adr/0010-approvals-over-confirmations')"
        >ADR-0010 · Approvals over confirmations →</a
      >
    </p>
  </section>
</template>
