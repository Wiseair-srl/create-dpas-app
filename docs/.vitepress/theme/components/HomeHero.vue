<script setup lang="ts">
import { withBase } from "vitepress";

import CopyCommand from "./CopyCommand.vue";
import PlanesDiagram from "./PlanesDiagram.vue";
</script>

<template>
  <header class="dh-hero">
    <div class="dh-hero-text">
      <p class="dh-wordmark">
        <svg class="dh-wordmark-mark" viewBox="0 0 32 32" aria-hidden="true">
          <path class="dh-wordmark-view" d="M16 2.5 29 9.5 16 16.5 3 9.5Z" />
          <path class="dh-wordmark-domain" d="M16 15.5 29 22.5 16 29.5 3 22.5Z" />
        </svg>
        <span>create-dpas-app</span>
        <span class="dh-wordmark-sub">/ Dual-Plane Agent Stack</span>
      </p>
      <h1 class="dh-hero-title">One capability layer for your UI, your copilot and MCP</h1>
      <p class="dh-hero-tagline">
        One command scaffolds a Dual-Plane Agent Stack application: one typed registry instead of a
        product and a parallel agent API, governed on the server and testable without a model.
      </p>
      <CopyCommand command="pnpm create dpas-app my-agent-app" />
      <p class="dh-hero-links">
        <a class="dh-link dh-link--strong" :href="withBase('/getting-started')">Get started →</a>
        <a class="dh-link" :href="withBase('/security/model')">Security model →</a>
      </p>
    </div>
    <div class="dh-hero-figure">
      <PlanesDiagram />
    </div>
  </header>
</template>
