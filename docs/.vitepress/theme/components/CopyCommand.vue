<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";

const props = defineProps<{ command: string }>();

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Older browsers and non-secure origins: the textarea fallback.
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  document.body.removeChild(area);
}

async function copy(): Promise<void> {
  try {
    await writeClipboard(props.command);
  } catch {
    return;
  }
  copied.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => (copied.value = false), 2000);
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="dh-cmd">
    <code class="dh-cmd-text"
      ><span class="dh-cmd-prompt" aria-hidden="true">$ </span>{{ command }}</code
    >
    <button
      type="button"
      class="dh-cmd-copy"
      :aria-label="copied ? 'Copied' : 'Copy command'"
      @click="copy"
    >
      {{ copied ? "copied" : "copy" }}
    </button>
    <span class="dh-sr" role="status">{{ copied ? "Command copied to clipboard" : "" }}</span>
  </div>
</template>
