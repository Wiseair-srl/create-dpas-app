<script setup lang="ts">
import HomeCallers from "./HomeCallers.vue";
import HomeHero from "./HomeHero.vue";
import HomeLedger from "./HomeLedger.vue";
import HomePlanes from "./HomePlanes.vue";
import HomeRoutes from "./HomeRoutes.vue";
import HomeTrace from "./HomeTrace.vue";
</script>

<template>
  <div class="dh">
    <HomeHero />
    <HomeCallers />
    <HomePlanes />
    <HomeTrace />
    <HomeLedger />
    <HomeRoutes />

    <p class="dh-provenance">
      Everything on this site describes the app the scaffolder actually generates, built on the
      published
      <a class="dh-link" href="https://www.npmjs.com/package/@agent-surface/core"
        ><code>@agent-surface/*</code></a
      >
      and
      <a class="dh-link" href="https://www.npmjs.com/package/@orpc-agent/core"
        ><code>@orpc-agent/*</code></a
      >
      packages, <a class="dh-link" href="https://mastra.ai">Mastra</a> and
      <a class="dh-link" href="https://www.assistant-ui.com">assistant-ui</a>. The architecture,
      capability and security guides are the same markdown that ships inside every generated app, so
      the two cannot drift.
    </p>
  </div>
</template>
