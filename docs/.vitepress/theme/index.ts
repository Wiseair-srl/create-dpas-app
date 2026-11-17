import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";

// Self-hosted mono face for the landing page: bundled at build time, no CDN.
import "@fontsource-variable/geist-mono/wght.css";
import "./custom.css";
import "./home.css";

import HomeLanding from "./components/HomeLanding.vue";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("HomeLanding", HomeLanding);
  },
} satisfies Theme;
