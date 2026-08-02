import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "build", ".data", "node_modules", "playwright-report", "test-results"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    /**
     * The UI primitives predate the React Compiler and are written for React 19
     * without it. Three of the compiler-era rules fire on patterns that are
     * deliberate here — a ref read while rendering to keep a measured width, a
     * `setState` in an effect that syncs a controlled input to a prop, a
     * virtualizer whose API the compiler cannot see through.
     *
     * Scoped to these files rather than switched off globally: in application
     * code the same rules catch real bugs, and this template's own screens are
     * held to them (see the keyed form in features/collections/ChaseDialog.tsx,
     * written that way BECAUSE the rule was right).
     */
    files: [
      "app/components/ui/table.tsx",
      "app/components/ui/date-picker.tsx",
      "app/components/ui/theme-toggle.tsx",
      "app/features/copilot/CopilotDock.tsx",
    ],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    // Build/setup scripts run in plain Node before anything is bundled.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
