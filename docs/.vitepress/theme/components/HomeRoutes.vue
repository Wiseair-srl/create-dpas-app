<script setup lang="ts">
import { withBase } from "vitepress";

type Route = { who: string; path: { text: string; link: string }[] };

const routes: Route[] = [
  {
    who: "Show me what this is.",
    path: [
      { text: "Getting started", link: "/getting-started" },
      { text: "The dual-plane model", link: "/concepts/dual-plane" },
      { text: "Architecture", link: "/concepts/architecture" },
    ],
  },
  {
    who: "I'm adding my own capabilities.",
    path: [
      { text: "Anatomy of a capability", link: "/concepts/capabilities" },
      { text: "Adding a capability", link: "/guides/adding-a-capability" },
      { text: "Testing", link: "/guides/testing" },
    ],
  },
  {
    who: "I'm reviewing its security.",
    path: [
      { text: "Security model", link: "/security/model" },
      { text: "Scaffolder guarantees", link: "/security/scaffolder" },
      { text: "Host protocol", link: "/reference/host-protocol" },
      { text: "Decision records", link: "/project/decisions" },
    ],
  },
  {
    who: "I'm putting it in front of real users.",
    path: [
      { text: "Connecting a model", link: "/guides/connecting-a-model" },
      { text: "Configuration", link: "/reference/configuration" },
      { text: "Deploying", link: "/guides/deploying" },
    ],
  },
];
</script>

<template>
  <section class="dh-section" aria-labelledby="dh-routes-title">
    <header class="dh-head">
      <p class="dh-eyebrow">reading paths</p>
      <h2 id="dh-routes-title" class="dh-h2">Where to go next</h2>
    </header>

    <ul class="dh-routes">
      <li v-for="route in routes" :key="route.who" class="dh-route">
        <p class="dh-route-who">“{{ route.who }}”</p>
        <ol class="dh-route-path">
          <li v-for="step in route.path" :key="step.link">
            <a class="dh-link" :href="withBase(step.link)">{{ step.text }}</a>
          </li>
        </ol>
      </li>
    </ul>
  </section>
</template>
