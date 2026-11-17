<script setup lang="ts">
/**
 * The page's only graphic motif: the rhombus (an isometric plane) from the
 * logo. `plane` decides its colour, and nothing else on the page is coloured.
 */
defineProps<{ plane: "view" | "domain" | "none" }>();
</script>

<template>
  <svg class="dh-mark" :class="`dh-mark--${plane}`" viewBox="0 0 16 10" aria-hidden="true">
    <path d="M8 .9 15.1 5 8 9.1.9 5Z" />
  </svg>
</template>
