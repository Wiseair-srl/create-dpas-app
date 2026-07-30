---
"create-dpas-app": minor
---

Connect an OpenRouter key from the assistant panel, and restore pointer
cursors on interactive elements.

The generated app can now go live without editing `.env`: paste a key in the
assistant's model settings and pick any OpenRouter model. The key is held in
the server process's memory only — never written to disk, never returned to
the browser (a masked hint is), never in a client bundle. Runtime entry is
enabled in development and disabled in production builds unless
`ALLOW_RUNTIME_MODEL_KEY=true`, because one process shares the key with every
visitor.

Also restores `cursor: pointer` on buttons, tabs, selects, checkboxes and
links (Tailwind v4 dropped it from preflight), with `not-allowed` on disabled
controls and `col-resize` on the assistant panel separator.
