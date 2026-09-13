import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "template/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["reference/**/*.mjs"],
    languageOptions: {
      globals: { fetch: "readonly", crypto: "readonly", ReadableStream: "readonly" },
    },
  },
  {
    files: ["reference/**/browser.mjs"],
    languageOptions: { globals: { document: "readonly", window: "readonly" } },
  },
  {
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
