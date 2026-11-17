<script setup lang="ts">
import { withBase } from "vitepress";

import PlaneMark from "./PlaneMark.vue";
</script>

<template>
  <section class="dh-section" aria-labelledby="dh-planes-title">
    <header class="dh-head">
      <p class="dh-eyebrow">view:* · domain:*</p>
      <h2 id="dh-planes-title" class="dh-h2">Two planes, never blurred</h2>
      <p class="dh-lede">
        Each capability belongs to exactly one plane. The plane is a property of the capability,
        never a choice the model makes.
      </p>
    </header>

    <div class="dh-planes">
      <div class="dh-plane dh-plane--view">
        <div class="dh-plane-head">
          <p class="dh-tag dh-tag--view"><PlaneMark plane="view" />view · browser</p>
          <h3 class="dh-h3">View plane</h3>
          <code class="dh-plane-id">view:invoices.pending.setFilters</code>
        </div>
        <dl class="dh-facts">
          <div>
            <dt>Runs</dt>
            <dd>In this browser tab, against the live screen.</dd>
          </div>
          <div>
            <dt>Registered by</dt>
            <dd>The component that owns the state. Unmount it and the capability is gone.</dd>
          </div>
          <div>
            <dt>Authorized by</dt>
            <dd>
              Its compiled contract, for an authenticated session. A tab with no session has no
              surface at all.
            </dd>
          </div>
        </dl>
      </div>

      <div class="dh-plane dh-plane--domain">
        <div class="dh-plane-head">
          <p class="dh-tag dh-tag--domain"><PlaneMark plane="domain" />domain · server</p>
          <h3 class="dh-h3">Domain plane</h3>
          <code class="dh-plane-id">domain:issue-invoice</code>
        </div>
        <dl class="dh-facts">
          <div>
            <dt>Runs</dt>
            <dd>On the server. Valid with no UI at all.</dd>
          </div>
          <div>
            <dt>Registered by</dt>
            <dd>An oRPC procedure with an <code>agent</code> block in its meta.</dd>
          </div>
          <div>
            <dt>Authorized by</dt>
            <dd>The server, re-authorized on every call: exposure, validation, policy, audit.</dd>
          </div>
        </dl>
      </div>

      <p class="dh-planes-close">
        <PlaneMark plane="none" />
        <span>The model sees one catalog and cannot tell them apart.</span>
      </p>
    </div>

    <p class="dh-foot">
      <a class="dh-link" :href="withBase('/concepts/dual-plane')">The dual-plane model →</a>
    </p>
  </section>
</template>
